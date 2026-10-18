// ===================================================================================
// MapMaker — Local village/town layer: generates the zoomed-in settlement layout
// (road topology consistent with the macro map, plots, landmark buildings, walls,
// foliage) for a given settlement.
// ===================================================================================

// Maps a dominant dx/dy direction to a canvas side: 0=N(top) 1=E(right) 2=S(bottom) 3=W(left)
function dirToSide(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy > 0 ? 2 : 0;
}
function oppositeSide(side) { return (side + 2) % 4; }

// Inspects the world data around a settlement so the local view's road topology and
// surrounding terrain stay consistent with the macro map (which directions roads /
// water / biomes lie in relative to the settlement).
function computeNeighborContext(settlement, data) {
  const cols = data.cols, rows = data.rows;
  const roadSides = [];
  for (const r of data.roads) {
    const pts = r.points;
    if (!pts.length) continue;
    const first = pts[0], last = pts[pts.length - 1];
    if (first.x === settlement.x && first.y === settlement.y) {
      const nxt = pts[Math.min(3, pts.length - 1)];
      roadSides.push(dirToSide(nxt.x - first.x, nxt.y - first.y));
    } else if (last.x === settlement.x && last.y === settlement.y) {
      const prv = pts[Math.max(0, pts.length - 4)];
      roadSides.push(dirToSide(prv.x - last.x, prv.y - last.y));
    }
  }

  let waterSide = null, waterDist = Infinity;
  const R = 12;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const xx = settlement.x + dx, yy = settlement.y + dy;
      if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
      const i = idx(xx, yy, cols);
      if (data.isWater[i] || data.isRiver[i]) {
        const d = Math.hypot(dx, dy);
        if (d > 0 && d < waterDist) { waterDist = d; waterSide = dirToSide(dx, dy); }
      }
    }
  }

  const sideOffsets = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
  const RAD = 6;
  const neighborBiomes = sideOffsets.map(o => {
    const xx = clamp(settlement.x + o.dx * RAD, 0, cols - 1), yy = clamp(settlement.y + o.dy * RAD, 0, rows - 1);
    return data.biome[idx(Math.round(xx), Math.round(yy), cols)];
  });

  return { roadSides, waterSide, waterDist, neighborBiomes };
}

function tierConfig(tier, sizeFactor) {
  const RANGES = {
    village: { buildings: [6, 14], canvas: [300, 340], size: [9, 18], wallChance: 0.12 },
    town: { buildings: [16, 30], canvas: [360, 430], size: [11, 24], wallChance: 0.55 },
    city: { buildings: [28, 58], canvas: [440, 540], size: [13, 28], wallChance: 0.85 },
    capital: { buildings: [55, 95], canvas: [560, 680], size: [15, 34], wallChance: 1.01 },
  };
  const r = RANGES[tier] || RANGES.village;
  return {
    buildingsTarget: Math.round(lerp(r.buildings[0], r.buildings[1], sizeFactor)),
    canvasSize: Math.round(lerp(r.canvas[0], r.canvas[1], sizeFactor)),
    size: r.size,
    wallChance: r.wallChance,
  };
}

function generateVillage(settlement, worldData, lparams, ctx) {
  const seedStr = worldData.seedStr + "|" + settlement.id + "|" + settlement.x + "," + settlement.y;
  const rng = mulberry32(hashSeed(seedStr));
  ctx = ctx || { roadSides: [], waterSide: null, waterDist: Infinity, neighborBiomes: ["grassland", "grassland", "grassland", "grassland"] };
  const cfg = tierConfig(settlement.tier, settlement.sizeFactor != null ? settlement.sizeFactor : 0.5);
  const W = cfg.canvasSize, H = cfg.canvasSize;
  const hasWalls = rng() < cfg.wallChance;

  const biome = worldData.biome[idx(settlement.x, settlement.y, worldData.cols)];
  const groundColor = `rgb(${BIOME_COLORS[biome].map(c => Math.round(Math.min(255, c * 1.05))).join(",")})`;

  // --- water edge: use the real-world direction when the settlement is coastal/riverside ---
  let water = null;
  if (settlement.waterNear) {
    const side = ctx.waterSide != null ? ctx.waterSide : Math.floor(rng() * 4);
    const depth = clamp(95 - ctx.waterDist * 6, 36, 100);
    water = { side, depth };
  }

  // --- main road topology derived from the settlement's actual road connections ---
  const curviness = lparams.scurve / 100;
  const sideCounts = [0, 0, 0, 0];
  ctx.roadSides.forEach(s => sideCounts[s]++);
  const rankedSides = [0, 1, 2, 3].filter(s => sideCounts[s] > 0).sort((a, b) => sideCounts[b] - sideCounts[a]);
  let entrySide, exitSide, extraSideQueue;
  if (rankedSides.length >= 2) {
    entrySide = rankedSides[0]; exitSide = rankedSides[1];
    extraSideQueue = ctx.roadSides.filter(s => s !== entrySide && s !== exitSide || sideCounts[s] > 1).slice();
    // keep extra occurrences beyond the first two used
    const used = { [entrySide]: 1, [exitSide]: 1 };
    extraSideQueue = ctx.roadSides.filter(s => {
      if (used[s] > 0 && (s === entrySide || s === exitSide)) { used[s]--; return false; }
      return true;
    });
  } else if (rankedSides.length === 1) {
    entrySide = rankedSides[0];
    exitSide = water ? oppositeSide(water.side) !== entrySide ? oppositeSide(entrySide) : (entrySide + 1) % 4 : oppositeSide(entrySide);
    extraSideQueue = [];
  } else {
    entrySide = water ? oppositeSide(water.side) : Math.floor(rng() * 4);
    exitSide = oppositeSide(entrySide);
    extraSideQueue = [];
  }

  function pointOnSide(side, t) {
    const m = 20 + t * (W - 40);
    switch (side) {
      case 0: return { x: m, y: 0 };
      case 1: return { x: W, y: m };
      case 2: return { x: W - m, y: H };
      default: return { x: 0, y: H - m };
    }
  }
  const pStart = pointOnSide(entrySide, 0.3 + rng() * 0.4);
  const pEnd = pointOnSide(exitSide, 0.3 + rng() * 0.4);
  const mainPts = [pStart];
  const segs = 4;
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const bx = lerp(pStart.x, pEnd.x, t), by = lerp(pStart.y, pEnd.y, t);
    const perpX = -(pEnd.y - pStart.y), perpY = (pEnd.x - pStart.x);
    const len = Math.hypot(perpX, perpY) || 1;
    const offset = (rng() - 0.5) * curviness * 70;
    mainPts.push({ x: bx + (perpX / len) * offset, y: by + (perpY / len) * offset });
  }
  mainPts.push(pEnd);

  // side streets: real connecting roads first (anchored to their true compass side), then a few decorative branches
  const streets = [{ points: mainPts, main: true }];
  for (const side of extraSideQueue) {
    const p0 = pointOnSide(side, 0.25 + rng() * 0.5);
    const segIdx = clamp(Math.floor(rng() * (mainPts.length - 1)), 0, mainPts.length - 2);
    const target = mainPts[segIdx];
    const mid = { x: lerp(p0.x, target.x, 0.5) + (rng() - 0.5) * 24, y: lerp(p0.y, target.y, 0.5) + (rng() - 0.5) * 24 };
    streets.push({ points: [p0, mid, target], main: false });
  }
  const nDecorativeBranches = Math.max(1, Math.round(2 + rng() * 2 - extraSideQueue.length * 0.4));
  for (let b = 0; b < nDecorativeBranches; b++) {
    const t = 0.2 + rng() * 0.6;
    const segIdx = clamp(Math.floor(t * (mainPts.length - 1)), 0, mainPts.length - 2);
    const a = mainPts[segIdx], c = mainPts[segIdx + 1];
    const ox = lerp(a.x, c.x, rng()), oy = lerp(a.y, c.y, rng());
    const dirx = c.x - a.x, diry = c.y - a.y;
    const len = Math.hypot(dirx, diry) || 1;
    const perpX = -diry / len, perpY = dirx / len;
    const sign = rng() > 0.5 ? 1 : -1;
    const length = 40 + rng() * 70;
    const jitterX = (rng() - 0.5) * 40, jitterY = (rng() - 0.5) * 40;
    const endX = clamp(ox + perpX * length * sign + jitterX, 10, W - 10);
    const endY = clamp(oy + perpY * length * sign + jitterY, 10, H - 10);
    streets.push({ points: [{ x: ox, y: oy }, { x: lerp(ox, endX, 0.5) + (rng() - 0.5) * 20, y: lerp(oy, endY, 0.5) + (rng() - 0.5) * 20 }, { x: endX, y: endY }], main: false });
  }

  // bridge wherever a road actually meets the water edge
  const bridges = [];
  if (water) {
    if (entrySide === water.side) bridges.push({ x: pStart.x, y: pStart.y });
    if (exitSide === water.side) bridges.push({ x: pEnd.x, y: pEnd.y });
  }

  function sampleStreet(points, spacing) {
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.round(d / spacing));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        out.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), dirx: (b.x - a.x) / (d || 1), diry: (b.y - a.y) / (d || 1) });
      }
    }
    return out;
  }

  const buildingDensity = lparams.bdens / 100;
  const buildings = [];
  const plots = [];
  const reserved = []; // circular no-build zones (market squares, plazas)
  function tryPlaceBuilding(cx, cy, w, h, angle, color, kind) {
    for (const z of reserved) { if (Math.hypot(z.x - cx, z.y - cy) < z.r + Math.max(w, h) * 0.4) return false; }
    for (const bb of buildings) {
      if (Math.hypot(bb.cx - cx, bb.cy - cy) < (bb.w + w) * 0.55) return false;
    }
    if (cx < 8 || cy < 8 || cx > W - 8 || cy > H - 8) return false;
    buildings.push({ cx, cy, w, h, angle, color, kind: kind || "house", important: kind && kind !== "house" });
    return true;
  }

  const centerX = W / 2, centerY = H / 2;
  const houseColor = settlement.tier === "village" ? "#8a6a4a" : settlement.tier === "town" ? "#9a7550" : "#a9815a";

  // --- Landmarks: placed before regular housing so they claim prime central real-estate ---
  // Market square: open plaza with stalls + well, reserved so houses don't overlap it
  const wantsMarket = settlement.tier === "village" ? rng() < 0.3 : true;
  if (wantsMarket) {
    const marketR = settlement.tier === "capital" ? 44 : settlement.tier === "city" ? 36 : settlement.tier === "town" ? 28 : 20;
    const mx = clamp(centerX + (rng() - 0.5) * W * 0.25, marketR + 12, W - marketR - 12);
    const my = clamp(centerY + (rng() - 0.5) * H * 0.25, marketR + 12, H - marketR - 12);
    reserved.push({ x: mx, y: my, r: marketR });
    buildings.push({ cx: mx, cy: my, w: 5, h: 5, angle: 0, color: "#6b7280", kind: "well", important: true });
    const stallCount = settlement.tier === "village" ? 3 : settlement.tier === "town" ? 5 : settlement.tier === "city" ? 7 : 9;
    const stallColors = ["#b23b3b", "#c9a24b", "#3b6ea5", "#4c8c5a"];
    for (let i = 0; i < stallCount; i++) {
      const a = (i / stallCount) * Math.PI * 2 + rng() * 0.3;
      const rr = marketR * (0.55 + rng() * 0.3);
      const sx = mx + Math.cos(a) * rr, sy = my + Math.sin(a) * rr;
      buildings.push({ cx: sx, cy: sy, w: 10 + rng() * 4, h: 7 + rng() * 2, angle: (a * 180 / Math.PI) + 90, color: stallColors[i % stallColors.length], kind: "stall", important: true });
    }
  }

  // Church / Cathedral landmark
  const wantsChurch = settlement.tier === "village" ? rng() < 0.22 : settlement.tier === "town" ? rng() < 0.75 : true;
  if (wantsChurch) {
    const isCathedral = settlement.tier === "city" || settlement.tier === "capital";
    const scale = isCathedral ? 1.5 : 1;
    let placed = false, tries = 0;
    while (!placed && tries < 30) {
      tries++;
      const a = rng() * Math.PI * 2, rr = Math.min(W, H) * (0.18 + rng() * 0.18);
      const cx = clamp(centerX + Math.cos(a) * rr, 30, W - 30);
      const cy = clamp(centerY + Math.sin(a) * rr, 30, H - 30);
      placed = tryPlaceBuilding(cx, cy, 20 * scale, 34 * scale, (rng() - 0.5) * 10, "#a8a097", "church");
    }
  }

  // Keep / Castle landmark (city & capital)
  const wantsKeep = settlement.tier === "capital" ? true : settlement.tier === "city" ? rng() < 0.7 : false;
  if (wantsKeep) {
    const scale = settlement.tier === "capital" ? 1.4 : 1;
    let placed = false, tries = 0;
    while (!placed && tries < 30) {
      tries++;
      const a = rng() * Math.PI * 2, rr = Math.min(W, H) * (0.1 + rng() * 0.12);
      const kx = clamp(centerX + Math.cos(a) * rr, 50, W - 50);
      const ky = clamp(centerY + Math.sin(a) * rr, 50, H - 50);
      if (tryPlaceBuilding(kx, ky, 40 * scale, 32 * scale, (rng() - 0.5) * 8, "#6b6659", "keep")) {
        reserved.push({ x: kx, y: ky, r: 30 * scale });
        placed = true;
      }
    }
  }

  for (const st of streets) {
    const samples = sampleStreet(st.points, 26);
    for (const s of samples) {
      if (rng() > buildingDensity) continue;
      const perpX = -s.diry, perpY = s.dirx;
      for (const sign of [1, -1]) {
        if (rng() > 0.78) continue;
        const setback = 14 + rng() * 6;
        const bx = s.x + perpX * setback * sign;
        const by = s.y + perpY * setback * sign;
        const [minS, maxS] = cfg.size;
        const w = minS + rng() * (maxS - minS);
        const h = w * (0.6 + rng() * 0.5);
        const angle = Math.atan2(s.diry, s.dirx) * 180 / Math.PI + (rng() - 0.5) * 12;
        if (buildings.filter(b => b.kind === "house").length < cfg.buildingsTarget) {
          if (tryPlaceBuilding(bx, by, w, h, angle, houseColor, "house")) {
            plots.push({ x: bx - w, y: by - h, w: w * 2, h: h * 2 });
          }
        }
      }
    }
  }

  // --- Stone walls with gates where roads cross them ---
  let wall = null;
  if (hasWalls && buildings.length) {
    let cxAvg = 0, cyAvg = 0;
    for (const b of buildings) { cxAvg += b.cx; cyAvg += b.cy; }
    cxAvg /= buildings.length; cyAvg /= buildings.length;
    let maxR = 30;
    for (const b of buildings) maxR = Math.max(maxR, Math.hypot(b.cx - cxAvg, b.cy - cyAvg) + Math.max(b.w, b.h) * 0.6);
    const radius = Math.min(maxR + 20, Math.min(W, H) / 2 - 12);
    const gateAngles = [Math.atan2(pStart.y - cyAvg, pStart.x - cxAvg), Math.atan2(pEnd.y - cyAvg, pEnd.x - cxAvg)];
    const N = Math.max(20, Math.round(radius / 6));
    const gateWidthAngle = (Math.PI * 2 / N) * 1.3;
    const ringPts = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const isGate = gateAngles.some(ga => {
        let d = Math.abs(a - ga) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        return d < gateWidthAngle;
      });
      const r = radius * (0.92 + rng() * 0.14);
      ringPts.push({ a, x: cxAvg + Math.cos(a) * r, y: cyAvg + Math.sin(a) * r, isGate });
    }
    wall = { cx: cxAvg, cy: cyAvg, radius, points: ringPts, gateAngles };
  }

  // --- Foliage: rejection-sampled, avoiding buildings/streets/walls ---
  const foliageDensity = lparams.fdens / 100;
  const foliageCount = Math.round((settlement.tier === "village" ? 70 : settlement.tier === "town" ? 60 : settlement.tier === "city" ? 45 : 35) * foliageDensity);
  const trees = [];
  let attempts = 0;
  while (trees.length < foliageCount && attempts < foliageCount * 12) {
    attempts++;
    const x = rng() * W, y = rng() * H;
    let bad = false;
    for (const bb of buildings) { if (Math.hypot(bb.cx - x, bb.cy - y) < Math.max(bb.w, bb.h) * 0.8 + 6) { bad = true; break; } }
    if (!bad) {
      for (const st of streets) {
        const samp = sampleStreet(st.points, 18);
        for (const s of samp) if (Math.hypot(s.x - x, s.y - y) < 10) { bad = true; break; }
        if (bad) break;
      }
    }
    if (bad) continue;
    trees.push({ x, y, scale: 0.6 + rng() * 0.9 });
  }

  return { W, H, groundColor, water, streets, buildings, plots, trees, bridges, wall, biome, settlement, ctx };
}
