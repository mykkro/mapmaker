// ===================================================================================
// MapMaker — Simplified WebGL 3D Preview (Three.js)
// Renders the world heightmap (correct elevation profile) with simplified boxy
// buildings/foliage, or the currently-open local village layout extruded in 3D.
// Exposes window.Mapmaker3D = { openWorld, openVillage, close }
// ===================================================================================
(function () {
  const HEIGHT_SCALE = 16;
  let renderer, camera, controls, scene;
  let rafHandle = null;
  let mode = "world"; // "world" | "village"
  let lastWorld = null; // { data, params }
  let lastVillage = null; // vdata

  function el(id) { return document.getElementById(id); }

  function disposeObject(obj) {
    obj.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      }
    });
  }

  function ensureRenderer() {
    if (renderer) return;
    const wrap = el("canvas3dWrap");
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    wrap.appendChild(renderer.domElement);
    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    window.addEventListener("resize", resize3D);
  }

  function resize3D() {
    if (!renderer) return;
    const wrap = el("canvas3dWrap");
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (w < 2 || h < 2) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function animate() {
    rafHandle = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  function biomeRGB(name) {
    const c = (window.BIOME_COLORS || {})[name] || [120, 150, 110];
    return new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
  }

  // Cheap deterministic 2D hash noise (no dependency on mapmaker.js's generator) used only
  // to add extra small-scale jaggedness to 3D terrain/rock geometry — purely cosmetic.
  function hash2(x, y) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function ridgeJitter(x, y) {
    let v = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < 3; o++) {
      v += (hash2(x * freq, y * freq) - 0.5) * amp;
      norm += amp; amp *= 0.5; freq *= 2.37;
    }
    return v / norm;
  }

  // Builds a hand-drawn-ish ground texture (sharper per-cell shading + grain) reusing the
  // same biome/elevation shading logic as the 2D raster, for a more realistic 3D ground.
  function buildWorldGroundTexture(data) {
    const cols = data.cols, rows = data.rows;
    const base = document.createElement("canvas");
    base.width = cols; base.height = rows;
    const bctx = base.getContext("2d");
    const img = bctx.createImageData(cols, rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const b = data.biome[i], h = data.height[i];
        // Lakes/ponds get their own flat water mesh layered on top (see buildWorldScene), so the
        // terrain underneath is painted as a dark lakebed rather than bright water-blue — otherwise
        // the lakebed cells show through as a second, slightly-offset "flat water" layer.
        let [r, g, bl] = b === "lake" ? [70, 86, 64] : ((window.BIOME_COLORS || {})[b] || [120, 150, 110]);
        let shade = b === "ocean" ? 1.18 - Math.max(0, data.seaLevel - h) * 2.4 : 0.68 + h * 0.38;
        shade *= 0.92 + hash2(x * 0.7, y * 0.7) * 0.16; // grain speckle
        shade = Math.max(0.4, Math.min(1.1, shade));
        const o = i * 4;
        img.data[o] = Math.min(255, r * shade); img.data[o + 1] = Math.min(255, g * shade); img.data[o + 2] = Math.min(255, bl * shade); img.data[o + 3] = 255;
      }
    }
    bctx.putImageData(img, 0, 0);
    // upscale moderately with smoothing, then add a finer dry-brush grain pass on top
    const UP = 4;
    const big = document.createElement("canvas");
    big.width = cols * UP; big.height = rows * UP;
    const gctx = big.getContext("2d");
    gctx.imageSmoothingEnabled = true;
    gctx.imageSmoothingQuality = "high";
    gctx.drawImage(base, 0, 0, big.width, big.height);
    gctx.globalCompositeOperation = "overlay";
    for (let i = 0; i < 2200; i++) {
      const gx = Math.random() * big.width, gy = Math.random() * big.height;
      const v = Math.random() * 60 - 30;
      gctx.fillStyle = `rgba(${128 + v},${128 + v},${128 + v},0.18)`;
      gctx.fillRect(gx, gy, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }
    gctx.globalCompositeOperation = "source-over";
    const tex = new THREE.CanvasTexture(big);
    tex.flipY = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 4;
    return tex;
  }

  // Shared "tree" prototype: a cone canopy + cylinder trunk, combined per-instance via one transform.
  function makeTreeGeometries() {
    const trunk = new THREE.CylinderGeometry(0.16, 0.2, 1, 5);
    trunk.translate(0, 0.5, 0);
    const canopy = new THREE.ConeGeometry(0.9, 1.8, 7);
    canopy.translate(0, 1.5, 0);
    return { trunk, canopy };
  }

  // Low-poly "rock" used both for mountain clusters and generic rubble.
  function makeRockGeometry() {
    const g = new THREE.DodecahedronGeometry(1, 0);
    return g;
  }

  // Builds a flat extruded ribbon of box segments following `points` (grid coords),
  // used for both roads and rivers so they're actually visible (plain THREE.Line hairlines
  // are not reliably visible across platforms).
  function buildFlatStrip(scene, points, width, colorHex, elevFn, yOffset, toX, toZ) {
    const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.9 });
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const ax = toX(a.x), az = toZ(a.y), bx = toX(b.x), bz = toZ(b.y);
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.001) continue;
      const w = typeof width === "function" ? width(a, b) : width;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(len * 1.05, 0.3, w), mat);
      const ea = elevFn(a.x, a.y), eb = elevFn(b.x, b.y);
      seg.position.set((ax + bx) / 2, Math.max(ea, eb) + yOffset, (az + bz) / 2);
      seg.rotation.y = -Math.atan2(bz - az, bx - ax);
      scene.add(seg);
    }
  }

  function addLights(scene) {
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3a3326, 0.75);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff3d8, 1.05);
    sun.position.set(120, 220, 90);
    scene.add(sun);
    const fill = new THREE.AmbientLight(0x404050, 0.25);
    scene.add(fill);
  }

  // -------------------------------------------------------------------------------
  // World scene: real heightmap-driven terrain mesh + simplified settlements/forest/
  // mountains/rivers/roads.
  // -------------------------------------------------------------------------------
  function buildWorldScene(data, params) {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f14);
    scene.fog = new THREE.Fog(0x0b0f14, 220, 820);
    addLights(scene);

    const cols = data.cols, rows = data.rows;
    const toX = x => x - cols / 2, toZ = y => y - rows / 2;
    // Elevation used everywhere (terrain mesh + anything placed on it): the real heightmap
    // plus extra jagged relief on mountain/snowpeak cells so peaks read as rocky ridges,
    // not smooth bumps.
    function heightAt(x, y) {
      const i = y * cols + x;
      const h = data.height[i];
      let extra = 0;
      const b = data.biome[i];
      if (b === "mountain" || b === "snowpeak") {
        const above = Math.max(0, h - data.mountainLevel);
        const ridge = ridgeJitter(x * 0.16, y * 0.16); // broad ridgelines/valleys
        const rough = ridgeJitter(x * 0.85, y * 0.85); // finer rock jaggedness on top
        extra = (ridge * 0.7 + rough * 0.3) * above * 24;
      }
      return h * HEIGHT_SCALE + extra;
    }
    // Smooth (non-jittered) elevation for things that should read as a continuous carved path
    // rather than following every small mountain bump — rivers, roads, and bridges.
    function smoothHeightAt(x, y) { return data.height[y * cols + x] * HEIGHT_SCALE; }

    // Terrain mesh: one vertex per cell, textured with a hand-drawn-ish ground texture.
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(cols * rows * 3);
    const uvs = new Float32Array(cols * rows * 2);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        positions[i * 3] = toX(x);
        positions[i * 3 + 1] = heightAt(x, y);
        positions[i * 3 + 2] = toZ(y);
        uvs[i * 2] = x / (cols - 1);
        uvs[i * 2 + 1] = y / (rows - 1);
      }
    }
    const indices = [];
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        const a = y * cols + x, b = a + 1, c = a + cols, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const groundTex = buildWorldGroundTexture(data);
    const terrainMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0 });
    const terrainMesh = new THREE.Mesh(geo, terrainMat);
    terrainMesh.receiveShadow = false;
    scene.add(terrainMesh);

    // Sea surface: a flat raft of quads built from the exact ocean cells (not a giant bounding
    // rectangle) — a full-extent plane would peek out past the coastline at grazing angles and
    // could visually masquerade as a second, perfectly flat "river" running alongside the real one.
    {
      const oceanMat = new THREE.MeshStandardMaterial({ color: 0x2f6f9e, transparent: true, opacity: 0.78, roughness: 0.25, metalness: 0.15 });
      const verts = [], indices = [];
      const yPos = data.seaLevel * HEIGHT_SCALE;
      let vi = 0;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          if (!data.isOcean[i]) continue;
          const x0 = toX(x - 0.52), x1 = toX(x + 0.52), z0 = toZ(y - 0.52), z1 = toZ(y + 0.52);
          verts.push(x0, yPos, z0, x1, yPos, z0, x1, yPos, z1, x0, yPos, z1);
          indices.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
          vi += 4;
        }
      }
      if (vi > 0) {
        const og = new THREE.BufferGeometry();
        og.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
        og.setIndex(indices);
        og.computeVertexNormals();
        scene.add(new THREE.Mesh(og, oceanMat));
      }
    }

    // Ponds / lakes above sea level: a flat raft of quads built from the exact basin cells
    // (not a generic circle) so the water conforms to the depression instead of floating over it
    if (data.ponds) {
      const pondMat = new THREE.MeshStandardMaterial({ color: 0x3f87b8, transparent: true, opacity: 0.5, roughness: 0.2, depthWrite: false });
      for (const p of data.ponds) {
        const verts = [], indices = [];
        const yPos = p.level * HEIGHT_SCALE + 0.1;
        let vi = 0;
        for (const ci of p.cells) {
          const cx = ci % cols, cy = Math.floor(ci / cols);
          const x0 = toX(cx - 0.52), x1 = toX(cx + 0.52), z0 = toZ(cy - 0.52), z1 = toZ(cy + 0.52);
          verts.push(x0, yPos, z0, x1, yPos, z0, x1, yPos, z1, x0, yPos, z1);
          indices.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
          vi += 4;
        }
        const pg = new THREE.BufferGeometry();
        pg.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
        pg.setIndex(indices);
        pg.computeVertexNormals();
        scene.add(new THREE.Mesh(pg, pondMat));
      }
    }

    // Mountains: no separate rock props — jaggedness comes entirely from the terrain mesh's
    // own geometry (see heightAt above), which reads more realistically than scattered props.

    // Cliffs: vertical rock faces at steep edges (the smooth terrain mesh alone can't show a
    // true drop, so we add a thin wall where a cliff cell has a much lower neighbor). Skipped
    // inside mountain/snowpeak terrain — that jaggedness already comes from the terrain mesh
    // itself, so adding wall boxes there just reads as a field of stray rocks.
    if (data.isCliff) {
      const cliffMat = new THREE.MeshStandardMaterial({ color: biomeRGB("mountain"), roughness: 1, flatShading: true });
      const cliffCells = [];
      for (let i = 0; i < cols * rows; i++) {
        if (!data.isCliff[i]) continue;
        if (data.biome[i] === "mountain" || data.biome[i] === "snowpeak") continue;
        cliffCells.push(i);
      }
      const stride = Math.max(1, Math.ceil(cliffCells.length / 700));
      for (let k = 0; k < cliffCells.length; k += stride) {
        const i = cliffCells[k];
        const x = i % cols, y = Math.floor(i / cols);
        let lowX = x, lowY = y, lowH = data.height[i];
        const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
        for (let d = 0; d < 4; d++) {
          const nx2 = x + DX[d], ny2 = y + DY[d];
          if (nx2 < 0 || ny2 < 0 || nx2 >= cols || ny2 >= rows) continue;
          const nh = data.height[ny2 * cols + nx2];
          if (nh < lowH) { lowH = nh; lowX = nx2; lowY = ny2; }
        }
        if (lowX === x && lowY === y) continue;
        const topY = heightAt(x, y), botY = Math.min(topY - 1, lowH * HEIGHT_SCALE);
        const wallH = topY - botY;
        if (wallH < 0.8) continue;
        const mx = (toX(x) + toX(lowX)) / 2, mz = (toZ(y) + toZ(lowY)) / 2;
        const wall = new THREE.Mesh(new THREE.BoxGeometry(1.1, wallH, 1.1), cliffMat);
        wall.position.set(mx, botY + wallH / 2, mz);
        scene.add(wall);
      }
    }

    // Forests: instanced trunks + canopies, subsampled & kept small/sparse
    {
      const forestCells = [];
      for (let i = 0; i < cols * rows; i++) {
        const b = data.biome[i];
        if (b === "forest" || b === "taiga" || b === "jungle") forestCells.push(i);
      }
      const forestFactor = (params.forestPct || 50) / 100;
      const targetMax = 1800;
      const stride = Math.max(1, Math.ceil((forestCells.length * forestFactor) / targetMax));
      const { trunk, canopy } = makeTreeGeometries();
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 1 });
      const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2e6b3e, roughness: 0.9 });
      const estCount = Math.ceil(forestCells.length / stride) * 2 + 4;
      const trunkInst = new THREE.InstancedMesh(trunk, trunkMat, estCount);
      const canopyInst = new THREE.InstancedMesh(canopy, canopyMat, estCount);
      const m = new THREE.Matrix4();
      let count = 0;
      for (let k = 0; k < forestCells.length; k += stride) {
        const i = forestCells[k];
        const x = i % cols, y = Math.floor(i / cols);
        const n = Math.random() < 0.25 + forestFactor * 0.3 ? 2 : 1;
        for (let t = 0; t < n && count < estCount; t++) {
          const scale = 0.4 + Math.random() * 0.4;
          const ox = toX(x) + (Math.random() - 0.5) * 0.9, oz = toZ(y) + (Math.random() - 0.5) * 0.9;
          m.makeScale(scale, scale, scale);
          m.setPosition(ox, heightAt(x, y), oz);
          trunkInst.setMatrixAt(count, m);
          canopyInst.setMatrixAt(count, m);
          count++;
        }
      }
      trunkInst.count = count; canopyInst.count = count;
      scene.add(trunkInst); scene.add(canopyInst);
    }

    // Rivers — flat visible ribbons (not hairline Lines), width grows with flow. Uses the
    // smooth (non-jittered) elevation so the path reads as a continuous carved channel even
    // when it cuts through jagged mountain terrain.
    const gorgeMat = new THREE.MeshStandardMaterial({ color: biomeRGB("mountain").multiplyScalar(0.8), roughness: 1, flatShading: true });
    for (const r of data.rivers) {
      const maxFlow = r.points.reduce((mx, p) => Math.max(mx, data.riverFlow[p.y * cols + p.x] || 0), 0);
      const w = Math.min(2.4, 0.7 + maxFlow * 0.22);
      buildFlatStrip(scene, r.points, w, 0x4fa8d8, smoothHeightAt, 0.15, toX, toZ);
      // Gorges: canyon walls flanking river segments that cut through much higher terrain
      for (let k = 1; k < r.points.length - 1; k++) {
        const p = r.points[k];
        if (!p.gorge) continue;
        const prev = r.points[k - 1], next = r.points[k + 1];
        const dirx = next.x - prev.x, diry = next.y - prev.y;
        const dlen = Math.hypot(dirx, diry) || 1;
        const perpX = -diry / dlen, perpY = dirx / dlen;
        let maxNeighbor = -Infinity;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = p.x + dx, yy = p.y + dy;
          if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
          const ni = yy * cols + xx;
          if (data.isRiver[ni] || data.isWater[ni]) continue;
          if (data.height[ni] > maxNeighbor) maxNeighbor = data.height[ni];
        }
        if (maxNeighbor === -Infinity) continue;
        const riverY = smoothHeightAt(p.x, p.y), wallTop = maxNeighbor * HEIGHT_SCALE;
        const wallH = wallTop - riverY;
        if (wallH < 1) continue;
        for (const side of [1, -1]) {
          const wx = toX(p.x) + perpX * (w * 0.5 + 1.2) * side, wz = toZ(p.y) + perpY * (w * 0.5 + 1.2) * side;
          const wall = new THREE.Mesh(new THREE.BoxGeometry(1.2, wallH, 1.2), gorgeMat);
          wall.position.set(wx, riverY + wallH / 2, wz);
          scene.add(wall);
        }
      }
    }

    // Roads + bridges — flat visible ribbons, also on the smooth elevation
    const bridgeGeo = new THREE.BoxGeometry(2.2, 0.5, 1.4);
    const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x9c7b4f });
    for (const r of data.roads) {
      buildFlatStrip(scene, r.points, 0.9, 0x8a6a3f, smoothHeightAt, 0.3, toX, toZ);
      for (const b of r.bridges) {
        const mesh = new THREE.Mesh(bridgeGeo, bridgeMat);
        mesh.position.set(toX(b.x), smoothHeightAt(b.x, b.y) + 0.45, toZ(b.y));
        scene.add(mesh);
      }
    }

    // Caves: dark recessed opening at the base of a nearby rock face
    if (data.caves) {
      const caveMat = new THREE.MeshBasicMaterial({ color: 0x050403 });
      const rimMat = new THREE.MeshStandardMaterial({ color: 0x4a4035, roughness: 1 });
      for (const c of data.caves) {
        const cy = heightAt(c.x, c.y);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.35, 6, 10, Math.PI), rimMat);
        rim.rotation.x = Math.PI / 2;
        rim.position.set(toX(c.x), cy + 0.05, toZ(c.y));
        scene.add(rim);
        const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.95, 12, 0, Math.PI), caveMat);
        mouth.rotation.x = -Math.PI / 2;
        mouth.position.set(toX(c.x), cy + 0.08, toZ(c.y));
        scene.add(mouth);
      }
    }

    // Settlements: simple blocky tower markers sized/colored by tier
    const TIER_COLOR = { village: 0xcaa24c, town: 0xd9a441, city: 0xe9532b, capital: 0xc0392b };
    const TIER_SCALE = { village: 1, town: 1.3, city: 1.7, capital: 2.3 };
    for (const s of data.settlements) {
      const sc = TIER_SCALE[s.tier] * (0.8 + (s.sizeFactor || 0.5) * 0.5);
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.6 * sc, 2.2 * sc, 1.6 * sc), new THREE.MeshStandardMaterial({ color: TIER_COLOR[s.tier] || 0xcaa24c, roughness: 0.8 }));
      body.position.y = 1.1 * sc;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.3 * sc, 1.4 * sc, 4), new THREE.MeshStandardMaterial({ color: 0x4a3418, roughness: 1 }));
      roof.rotation.y = Math.PI / 4;
      roof.position.y = 2.2 * sc + 0.7 * sc;
      g.add(body, roof);
      g.position.set(toX(s.x), heightAt(s.x, s.y), toZ(s.y));
      scene.add(g);
    }

    const span = Math.max(cols, rows);
    camera.position.set(span * 0.42, span * 0.5, span * 0.55);
    controls.target.set(0, data.seaLevel * HEIGHT_SCALE, 0);
    camera.far = span * 4;
    camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------------
  // Village scene: reuses the already-computed 2D layout (vdata) and extrudes it.
  // -------------------------------------------------------------------------------
  function buildVillageScene(vdata) {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f14);
    addLights(scene);

    const W = vdata.W, H = vdata.H;
    const toX = x => x - W / 2, toZ = y => y - H / 2;

    const groundGeo = new THREE.PlaneGeometry(W, H);
    groundGeo.rotateX(-Math.PI / 2);
    const gc = vdata.groundColor.match(/[\d.]+/g).map(Number);
    const groundMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(gc[0] / 255, gc[1] / 255, gc[2] / 255), roughness: 1 });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    scene.add(groundMesh);

    if (vdata.water) {
      const rect = { 0: { x: 0, y: 0, w: W, h: vdata.water.depth }, 2: { x: 0, y: H - vdata.water.depth, w: W, h: vdata.water.depth }, 1: { x: W - vdata.water.depth, y: 0, w: vdata.water.depth, h: H }, 3: { x: 0, y: 0, w: vdata.water.depth, h: H } }[vdata.water.side];
      const wg = new THREE.PlaneGeometry(rect.w, rect.h);
      wg.rotateX(-Math.PI / 2);
      const wMesh = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0x3f87b8, transparent: true, opacity: 0.85, roughness: 0.3 }));
      wMesh.position.set(toX(rect.x + rect.w / 2), 0.05, toZ(rect.y + rect.h / 2));
      scene.add(wMesh);
      for (const br of vdata.bridges) {
        const bMesh = new THREE.Mesh(new THREE.BoxGeometry(10, 0.8, 5), new THREE.MeshStandardMaterial({ color: 0x9c7b4f }));
        bMesh.position.set(toX(br.x), 0.5, toZ(br.y));
        scene.add(bMesh);
      }
    }

    // Streets as flat extruded strips
    const roadMat = new THREE.MeshStandardMaterial({ color: 0xd8c79a, roughness: 1 });
    for (const st of vdata.streets) {
      const width = st.main ? 8 : 5;
      for (let i = 0; i < st.points.length - 1; i++) {
        const a = st.points[i], b = st.points[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 0.01) continue;
        const seg = new THREE.Mesh(new THREE.BoxGeometry(len, 0.25, width), roadMat);
        seg.position.set(toX((a.x + b.x) / 2), 0.1, toZ((a.y + b.y) / 2));
        seg.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
        scene.add(seg);
      }
    }

    // Walls: box segments between consecutive non-gate ring points, plus gate markers
    if (vdata.wall) {
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x746a5c, roughness: 1 });
      const pts = vdata.wall.points;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if (a.isGate || b.isGate) continue;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(len * 1.05, 9, 2.4), wallMat);
        seg.position.set(toX((a.x + b.x) / 2), 4.5, toZ((a.y + b.y) / 2));
        seg.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
        scene.add(seg);
      }
      for (const ga of vdata.wall.gateAngles) {
        const gx = vdata.wall.cx + Math.cos(ga) * vdata.wall.radius, gy = vdata.wall.cy + Math.sin(ga) * vdata.wall.radius;
        const gate = new THREE.Mesh(new THREE.BoxGeometry(4, 11, 4), new THREE.MeshStandardMaterial({ color: 0x5c5245 }));
        gate.position.set(toX(gx), 5.5, toZ(gy));
        scene.add(gate);
      }
    }

    // Buildings: extruded boxes with simple accent geometry per kind
    for (const b of vdata.buildings) {
      const g = new THREE.Group();
      g.position.set(toX(b.cx), 0, toZ(b.cy));
      g.rotation.y = -b.angle * Math.PI / 180;
      const colorHex = new THREE.Color(b.color);
      if (b.kind === "well") {
        const well = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 3, 10), new THREE.MeshStandardMaterial({ color: 0x8d8275 }));
        well.position.y = 1.5;
        g.add(well);
      } else {
        const height = b.kind === "church" ? b.h * 1.1 : b.kind === "keep" ? b.h * 1.0 : b.kind === "stall" ? 4 : 7 + b.w * 0.15;
        const box = new THREE.Mesh(new THREE.BoxGeometry(b.w, height, b.h), new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.85 }));
        box.position.y = height / 2;
        g.add(box);
        if (b.kind === "church") {
          const spire = new THREE.Mesh(new THREE.ConeGeometry(b.w * 0.45, height * 0.7, 4), new THREE.MeshStandardMaterial({ color: 0x8f8678 }));
          spire.rotation.y = Math.PI / 4;
          spire.position.y = height + height * 0.35;
          g.add(spire);
        } else if (b.kind === "keep") {
          const towerH = height * 1.3;
          for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const tower = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.22, towerH, b.w * 0.22), new THREE.MeshStandardMaterial({ color: 0x59544a }));
            tower.position.set(sx * b.w * 0.46, towerH / 2, sy * b.h * 0.42);
            g.add(tower);
          }
        } else if (b.kind === "stall") {
          const awning = new THREE.Mesh(new THREE.ConeGeometry(b.w * 0.75, 3, 4), new THREE.MeshStandardMaterial({ color: colorHex }));
          awning.rotation.y = Math.PI / 4;
          awning.position.y = height + 1.5;
          g.add(awning);
        } else {
          const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(b.w, b.h) * 0.75, height * 0.55, 4), new THREE.MeshStandardMaterial({ color: 0x4a3418 }));
          roof.rotation.y = Math.PI / 4;
          roof.position.y = height + height * 0.27;
          g.add(roof);
        }
      }
      scene.add(g);
    }

    // Foliage
    {
      const { trunk, canopy } = makeTreeGeometries();
      const trunkInst = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x5a3d26 }), vdata.trees.length || 1);
      const canopyInst = new THREE.InstancedMesh(canopy, new THREE.MeshStandardMaterial({ color: 0x2e6b3e }), vdata.trees.length || 1);
      const m = new THREE.Matrix4();
      vdata.trees.forEach((t, i) => {
        m.makeScale(t.scale * 2.2, t.scale * 2.2, t.scale * 2.2);
        m.setPosition(toX(t.x), 0, toZ(t.y));
        trunkInst.setMatrixAt(i, m);
        canopyInst.setMatrixAt(i, m);
      });
      scene.add(trunkInst); scene.add(canopyInst);
    }

    const span = Math.max(W, H);
    camera.position.set(span * 0.38, span * 0.42, span * 0.5);
    controls.target.set(0, 4, 0);
    camera.far = span * 4;
    camera.updateProjectionMatrix();
  }

  function rebuild() {
    if (mode === "village" && lastVillage) buildVillageScene(lastVillage);
    else if (lastWorld) buildWorldScene(lastWorld.data, lastWorld.params);
  }

  // If the user jumps straight to the "Local Village" tab without first picking a
  // settlement via "Preview Local in 3D", auto-generate one (prefer the capital) so the
  // tab is never a dead end.
  function ensureVillageForWorld() {
    if (lastVillage || !lastWorld) return;
    const settlements = lastWorld.data.settlements || [];
    if (!settlements.length) return;
    const s = settlements.find(x => x.tier === "capital") || settlements[0];
    const ctx = window.computeNeighborContext(s, lastWorld.data);
    const lparams = { bdens: 60, fdens: 55, scurve: 30, foliageTop: false };
    lastVillage = window.generateVillage(s, lastWorld.data, lparams, ctx);
  }

  function setMode(next) {
    if (next === "village") {
      ensureVillageForWorld();
      if (!lastVillage) return;
    }
    mode = next;
    el("tab3dWorld").classList.toggle("active", mode === "world");
    el("tab3dVillage").classList.toggle("active", mode === "village");
    el("modal3dTitle").textContent = mode === "village" && lastVillage ? "3D Preview — " + lastVillage.settlement.name : "3D Preview — World";
    rebuild();
  }

  function openModal() {
    ensureRenderer();
    el("modal3d").classList.add("open");
    resize3D();
  }

  function startLoop() {
    if (!rafHandle) animate();
  }

  function openWorld(data, params) {
    lastWorld = { data, params };
    el("tab3dVillage").disabled = !(data.settlements && data.settlements.length);
    ensureRenderer();
    setMode("world");
    openModal();
    startLoop();
  }
  function openVillage(vdata) {
    lastVillage = vdata;
    el("tab3dVillage").disabled = false;
    ensureRenderer();
    setMode("village");
    openModal();
    startLoop();
  }
  function close() {
    el("modal3d").classList.remove("open");
    if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = null; }
  }

  function wireUI() {
    el("btnClose3D").addEventListener("click", close);
    el("tab3dWorld").addEventListener("click", () => setMode("world"));
    el("tab3dVillage").addEventListener("click", () => setMode("village"));
  }
  document.addEventListener("DOMContentLoaded", wireUI);

  window.Mapmaker3D = { openWorld, openVillage, close };
})();
