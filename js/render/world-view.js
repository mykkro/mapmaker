// ===================================================================================
// MapMaker — World view renderer: terrain raster + every vector overlay layer
// (mountains, cliffs, rivers/gorges, caves, forests, roads/bridges, settlements,
// labels), the biome legend, and pan/zoom for the main map canvas.
// ===================================================================================
const IMG_W = 1200, IMG_H = 760; // world canvas size (svg viewBox units)

function buildTerrainRaster(data, params) {
  const { cols, rows } = data;
  const off = document.createElement("canvas");
  off.width = cols; off.height = rows;
  const ctx = off.getContext("2d");
  const img = ctx.createImageData(cols, rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = idx(x, y, cols);
      const b = data.biome[i];
      const h = data.height[i];
      let [r, g, bl] = BIOME_COLORS[b] || [120, 120, 120];
      let shade;
      if (b === "ocean") {
        const depth = Math.max(0, data.seaLevel - h);
        shade = 1.18 - depth * 2.4;
      } else if (b === "lake") {
        shade = 1.0;
      } else {
        shade = 0.80 + h * 0.5;
      }
      shade = clamp(shade, 0.5, 1.3);
      r = Math.min(255, r * shade); g = Math.min(255, g * shade); bl = Math.min(255, bl * shade);
      const o = i * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = bl; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const big = document.createElement("canvas");
  big.width = IMG_W; big.height = IMG_H;
  const bctx = big.getContext("2d");
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = "high";
  bctx.drawImage(off, 0, 0, IMG_W, IMG_H);
  return big.toDataURL("image/png");
}

let worldState = null; // {data, params}
let panZoom = { x: 0, y: 0, scale: 1 };

function renderWorld(data, params) {
  const svg = document.getElementById("world");
  svg.setAttribute("viewBox", `0 0 ${IMG_W} ${IMG_H}`);
  svg.innerHTML = "";
  ensureDefs(svg);
  const scaleX = IMG_W / data.cols, scaleY = IMG_H / data.rows;

  const gRoot = el("g", { id: "viewport" });
  svg.appendChild(gRoot);

  // terrain raster
  const gTerrain = el("g", { id: "layer-terrain" });
  const dataUrl = buildTerrainRaster(data, params);
  gTerrain.appendChild(el("image", { x: 0, y: 0, width: IMG_W, height: IMG_H, href: dataUrl, "image-rendering": "optimizeQuality" }));
  gRoot.appendChild(gTerrain);

  // mountains
  const gMtn = el("g", { id: "layer-mountains" });
  for (let y = 0; y < data.rows; y++) {
    for (let x = 0; x < data.cols; x++) {
      const i = idx(x, y, data.cols);
      if (data.biome[i] !== "mountain" && data.biome[i] !== "snowpeak") continue;
      if (data.rng() > 0.42) continue;
      const cx = (x + 0.5) * scaleX + (data.rng() - 0.5) * scaleX * 0.6;
      const cy = (y + 0.5) * scaleY + (data.rng() - 0.5) * scaleY * 0.6;
      const scale = 0.7 + data.height[i] * 0.9;
      const snow = data.biome[i] === "snowpeak" ? 1 : 0;
      const use = el("use", { href: "#glyph-mountain", x: cx, y: cy, transform: `translate(${cx.toFixed(1)},${cy.toFixed(1)}) scale(${scale.toFixed(2)}) translate(${-cx.toFixed(1)},${-cy.toFixed(1)})` });
      if (snow) use.setAttribute("opacity", "1");
      gMtn.appendChild(use);
    }
  }
  gRoot.appendChild(gMtn);

  // cliffs: hachure tick marks along steep slope edges, perpendicular to the grade
  const gCliffs = el("g", { id: "layer-cliffs" });
  for (let y = 1; y < data.rows - 1; y++) {
    for (let x = 1; x < data.cols - 1; x++) {
      const i = idx(x, y, data.cols);
      if (!data.isCliff[i]) continue;
      if (data.rng() > 0.55) continue;
      const hL = data.height[idx(x - 1, y, data.cols)], hR = data.height[idx(x + 1, y, data.cols)];
      const hU = data.height[idx(x, y - 1, data.cols)], hD = data.height[idx(x, y + 1, data.cols)];
      const gx = hR - hL, gy = hD - hU; // gradient (points downhill)
      const glen = Math.hypot(gx, gy) || 1;
      const nx = gx / glen, ny = gy / glen; // normal (downhill direction)
      const cx = (x + 0.5) * scaleX, cy = (y + 0.5) * scaleY;
      const tickLen = 4 + data.rng() * 2.5;
      const perpX = -ny, perpY = nx;
      const x1 = cx - perpX * tickLen * 0.5, y1 = cy - perpY * tickLen * 0.5;
      const x2 = cx + perpX * tickLen * 0.5, y2 = cy + perpY * tickLen * 0.5;
      gCliffs.appendChild(el("line", { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1), stroke: "#4a4035", "stroke-width": 1, opacity: 0.55 }));
    }
  }
  gRoot.appendChild(gCliffs);

  // rivers & lake outlines (canyon-wall hachures on gorge segments)
  const gRiver = el("g", { id: "layer-rivers" });
  for (const r of data.rivers) {
    const d = catmullRomPath(r.points, scaleX, scaleY);
    const maxFlow = r.points.reduce((m, p) => Math.max(m, data.riverFlow[idx(p.x, p.y, data.cols)] || 0), 0);
    const w = clamp(1.2 + maxFlow * 0.5, 1.2, 6);
    gRiver.appendChild(el("path", { d, fill: "none", stroke: "#3f87b8", "stroke-width": w, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.9 }));
    for (let k = 1; k < r.points.length - 1; k++) {
      const p = r.points[k];
      if (!p.gorge) continue;
      const prev = r.points[k - 1], next = r.points[k + 1];
      const dirx = next.x - prev.x, diry = next.y - prev.y;
      const dlen = Math.hypot(dirx, diry) || 1;
      const perpX = -diry / dlen, perpY = dirx / dlen;
      const px = (p.x + 0.5) * scaleX, py = (p.y + 0.5) * scaleY;
      for (const side of [1, -1]) {
        const ox = px + perpX * (w * 0.5 + 2.5) * side, oy = py + perpY * (w * 0.5 + 2.5) * side;
        gRiver.appendChild(el("line", {
          x1: (ox - perpX * 3.5 * side).toFixed(1), y1: (oy - perpY * 3.5 * side).toFixed(1),
          x2: (ox + perpX * 1.5 * side).toFixed(1), y2: (oy + perpY * 1.5 * side).toFixed(1),
          stroke: "#3d3327", "stroke-width": 1.1, opacity: 0.65,
        }));
      }
    }
  }
  gRoot.appendChild(gRiver);

  // caves: POI glyph on cliff/mountain faces
  const gCaves = el("g", { id: "layer-caves" });
  for (const c of data.caves) {
    const cx = (c.x + 0.5) * scaleX, cy = (c.y + 0.5) * scaleY;
    gCaves.appendChild(el("use", { href: "#glyph-cave", transform: `translate(${cx.toFixed(1)},${cy.toFixed(1)}) scale(1.1)` }));
  }
  gRoot.appendChild(gCaves);

  // forests
  const gForest = el("g", { id: "layer-forests" });
  const forestFactor = params.forestPct / 100;
  for (let y = 0; y < data.rows; y++) {
    for (let x = 0; x < data.cols; x++) {
      const i = idx(x, y, data.cols);
      const b = data.biome[i];
      if (!(b === "forest" || b === "taiga" || b === "jungle")) continue;
      if (data.isRiver[i]) continue;
      const density = b === "jungle" ? 1.3 : b === "forest" ? 1.0 : 0.6;
      const count = Math.round(data.rng() * 2.2 * density * forestFactor);
      for (let k = 0; k < count; k++) {
        const cx = (x + data.rng()) * scaleX;
        const cy = (y + data.rng()) * scaleY;
        const sc = 0.5 + data.rng() * 0.7;
        gForest.appendChild(el("use", { href: "#glyph-tree", transform: `translate(${cx.toFixed(1)},${cy.toFixed(1)}) scale(${sc.toFixed(2)})` }));
      }
    }
  }
  gRoot.appendChild(gForest);

  // roads
  const gRoads = el("g", { id: "layer-roads" });
  const gBridges = el("g", { id: "layer-bridges" });
  for (const r of data.roads) {
    const d = catmullRomPath(r.points, scaleX, scaleY);
    gRoads.appendChild(el("path", { d, fill: "none", stroke: "#7a5a33", "stroke-width": 2, "stroke-dasharray": "0", opacity: 0.85, "stroke-linecap": "round" }));
    for (const b of r.bridges) {
      const bx = (b.x + 0.5) * scaleX, by = (b.y + 0.5) * scaleY;
      gBridges.appendChild(el("use", { href: "#glyph-bridge", transform: `translate(${bx.toFixed(1)},${by.toFixed(1)})` }));
    }
  }
  gRoot.appendChild(gRoads);
  gRoot.appendChild(gBridges);

  // settlements + labels
  const gSettle = el("g", { id: "layer-settlements" });
  const gLabels = el("g", { id: "layer-labels" });
  const TIER_GLYPH = { capital: "#glyph-capital", city: "#glyph-city", town: "#glyph-town", village: "#glyph-village" };
  const TIER_FONT = { capital: 15, city: 13, town: 11, village: 10 };
  const TIER_LABEL_DY = { capital: 23, city: 20, town: 17, village: 14 };
  for (const s of data.settlements) {
    const sx = (s.x + 0.5) * scaleX, sy = (s.y + 0.5) * scaleY;
    const glyph = TIER_GLYPH[s.tier] || "#glyph-village";
    const markerScale = 0.8 + (s.sizeFactor || 0.5) * 0.5;
    const g = el("g", { class: "settlement-marker", "data-id": s.id, transform: `translate(${sx.toFixed(1)},${sy.toFixed(1)}) scale(${markerScale.toFixed(2)})` });
    g.appendChild(el("use", { href: glyph }));
    gSettle.appendChild(g);
    const label = el("text", { x: sx, y: sy + TIER_LABEL_DY[s.tier], "text-anchor": "middle", fill: "#f4ecd8", "font-size": TIER_FONT[s.tier], "font-family": "Georgia, serif", stroke: "#1a1a1a", "stroke-width": 0.35, "paint-order": "stroke", "data-id": s.id });
    label.textContent = s.name;
    gLabels.appendChild(label);
  }
  gRoot.appendChild(gSettle);
  gRoot.appendChild(gLabels);

  applyLayerVisibility();
  renderLegend();
}

function applyLayerVisibility() {
  document.querySelectorAll("#layerChecks input[data-layer]").forEach(cb => {
    const g = document.getElementById("layer-" + cb.dataset.layer);
    if (g) g.style.display = cb.checked ? "" : "none";
  });
}

function renderLegend() {
  const legend = document.getElementById("legend");
  legend.innerHTML = "";
  for (const key in BIOME_LABELS) {
    const [r, g, b] = BIOME_COLORS[key];
    const item = document.createElement("div");
    item.innerHTML = `<span class="sw" style="background:rgb(${r},${g},${b})"></span>${BIOME_LABELS[key]}`;
    legend.appendChild(item);
  }
}

// ---------------------------------------------------------------------------------
// Pan & zoom (world)
// ---------------------------------------------------------------------------------
function applyPanZoom() {
  const vp = document.getElementById("viewport");
  if (!vp) return;
  vp.setAttribute("transform", `translate(${panZoom.x},${panZoom.y}) scale(${panZoom.scale})`);
}
function setupPanZoom() {
  const wrap = document.getElementById("mapwrap");
  const svg = document.getElementById("world");
  let dragging = false, lastX = 0, lastY = 0;
  wrap.addEventListener("mousedown", e => { if (e.target.closest(".settlement-marker")) return; dragging = true; lastX = e.clientX; lastY = e.clientY; wrap.classList.add("panning"); });
  window.addEventListener("mouseup", () => { dragging = false; wrap.classList.remove("panning"); });
  window.addEventListener("mousemove", e => {
    if (!dragging) return;
    panZoom.x += (e.clientX - lastX); panZoom.y += (e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
    applyPanZoom();
  });
  wrap.addEventListener("wheel", e => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newScale = clamp(panZoom.scale * factor, 0.4, 6);
    panZoom.x = mx - (mx - panZoom.x) * (newScale / panZoom.scale);
    panZoom.y = my - (my - panZoom.y) * (newScale / panZoom.scale);
    panZoom.scale = newScale;
    applyPanZoom();
  }, { passive: false });
  document.getElementById("zoomIn").onclick = () => { panZoom.scale = clamp(panZoom.scale * 1.2, 0.4, 6); applyPanZoom(); };
  document.getElementById("zoomOut").onclick = () => { panZoom.scale = clamp(panZoom.scale / 1.2, 0.4, 6); applyPanZoom(); };
  document.getElementById("zoomReset").onclick = () => { panZoom = { x: 0, y: 0, scale: 1 }; applyPanZoom(); };
}
