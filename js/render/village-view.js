// ===================================================================================
// MapMaker — Local village view renderer: ground/water, ambient neighbor-biome
// context bands, plots, walls & gates, streets & bridges, landmark/house buildings,
// and foliage.
// ===================================================================================
const EDGE_SIDE_RECT = (side, W, H, band) => {
  if (side === 0) return { x: 0, y: 0, w: W, h: band };
  if (side === 2) return { x: 0, y: H - band, w: W, h: band };
  if (side === 1) return { x: W - band, y: 0, w: band, h: H };
  return { x: 0, y: 0, w: band, h: H };
};

function renderVillage(vdata, lparams) {
  const svg = document.getElementById("village");
  svg.setAttribute("viewBox", `0 0 ${vdata.W} ${vdata.H}`);
  svg.innerHTML = "";
  ensureDefs(svg);
  const edgeRng = mulberry32(hashSeed(vdata.settlement.id + "edge"));

  const gGround = el("g", { id: "llayer-ground" });
  gGround.appendChild(el("rect", { x: 0, y: 0, width: vdata.W, height: vdata.H, fill: vdata.groundColor }));

  // ambient context bands: tint + scatter decoration matching the real neighboring world biome per side
  const band = Math.round(30 + (vdata.W / 600) * 24);
  const neighborBiomes = vdata.ctx && vdata.ctx.neighborBiomes ? vdata.ctx.neighborBiomes : [];
  for (let side = 0; side < 4; side++) {
    if (vdata.water && vdata.water.side === side) continue;
    const nb = neighborBiomes[side];
    if (!nb || nb === vdata.biome) continue;
    const rect = EDGE_SIDE_RECT(side, vdata.W, vdata.H, band);
    const [r, g, b] = BIOME_COLORS[nb] || [110, 130, 95];
    gGround.appendChild(el("rect", { x: rect.x, y: rect.y, width: rect.w, height: rect.h, fill: `rgb(${r},${g},${b})`, opacity: 0.32 }));
    for (let i = 0; i < 12; i++) {
      const x = rect.x + edgeRng() * rect.w, y = rect.y + edgeRng() * rect.h;
      if (nb === "forest" || nb === "taiga" || nb === "jungle") {
        gGround.appendChild(el("use", { href: "#glyph-tree", transform: `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${(0.55 + edgeRng() * 0.6).toFixed(2)})` }));
      } else if (nb === "mountain" || nb === "snowpeak") {
        gGround.appendChild(el("use", { href: "#glyph-mountain", transform: `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${(0.3 + edgeRng() * 0.25).toFixed(2)})` }));
      } else if (nb === "desert" || nb === "beach") {
        gGround.appendChild(el("circle", { cx: x, cy: y, r: 1 + edgeRng() * 1.6, fill: "#d8c088", opacity: 0.6 }));
      }
    }
  }

  // subtle texture dots
  const texRng = mulberry32(hashSeed(vdata.settlement.id + "tex"));
  for (let i = 0; i < 140; i++) {
    gGround.appendChild(el("circle", { cx: texRng() * vdata.W, cy: texRng() * vdata.H, r: 0.6 + texRng() * 0.8, fill: "#000", opacity: 0.04 }));
  }
  if (vdata.water) {
    const rect = EDGE_SIDE_RECT(vdata.water.side, vdata.W, vdata.H, vdata.water.depth);
    gGround.appendChild(el("rect", { x: rect.x, y: rect.y, width: rect.w, height: rect.h, fill: "#3f87b8", opacity: 0.85 }));
  }

  const gPlots = el("g", { id: "llayer-plots" });
  for (const p of vdata.plots) {
    gPlots.appendChild(el("rect", { x: p.x, y: p.y, width: p.w, height: p.h, fill: "none", stroke: "#000", "stroke-opacity": 0.12, "stroke-dasharray": "2,2" }));
  }

  const gWalls = el("g", { id: "llayer-walls" });
  if (vdata.wall) {
    const w = vdata.wall;
    // split ring points into contiguous non-gate runs so gates render as visible gaps
    const runs = [];
    let cur = [];
    for (let i = 0; i <= w.points.length; i++) {
      const p = w.points[i % w.points.length];
      if (i < w.points.length && !p.isGate) { cur.push(p); }
      else { if (cur.length > 1) runs.push(cur); cur = []; }
    }
    if (cur.length > 1) runs.push(cur);
    for (const run of runs) {
      const d = "M " + run.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L ");
      gWalls.appendChild(el("path", { d, fill: "none", stroke: "#746a5c", "stroke-width": 7, "stroke-linejoin": "round" }));
      gWalls.appendChild(el("path", { d, fill: "none", stroke: "#8f8678", "stroke-width": 3.5, "stroke-linejoin": "round" }));
      // crenellations: small merlons poking outward every other vertex
      for (let i = 0; i < run.length; i += 2) {
        const p = run[i];
        const nx = (p.x - w.cx) / (w.radius || 1), ny = (p.y - w.cy) / (w.radius || 1);
        const mx = p.x + nx * 5, my = p.y + ny * 5;
        gWalls.appendChild(el("rect", { x: -2.6, y: -3.4, width: 5.2, height: 6.8, fill: "#746a5c", transform: `translate(${mx.toFixed(1)},${my.toFixed(1)}) rotate(${(Math.atan2(ny, nx) * 180 / Math.PI).toFixed(1)})` }));
      }
    }
    for (const ga of w.gateAngles) {
      const gx = w.cx + Math.cos(ga) * w.radius, gy = w.cy + Math.sin(ga) * w.radius;
      gWalls.appendChild(el("rect", { x: -7, y: -9, width: 14, height: 18, rx: 2, fill: "#5c5245", stroke: "#2e2820", "stroke-width": 1, transform: `translate(${gx.toFixed(1)},${gy.toFixed(1)}) rotate(${(ga * 180 / Math.PI + 90).toFixed(1)})` }));
    }
  }

  const gRoads = el("g", { id: "llayer-roads" });
  for (const st of vdata.streets) {
    const d = catmullRomPath(st.points, 1, 1);
    gRoads.appendChild(el("path", { d, fill: "none", stroke: "#d8c79a", "stroke-width": st.main ? 9 : 5.5, "stroke-linecap": "round", opacity: 0.95 }));
    gRoads.appendChild(el("path", { d, fill: "none", stroke: "#b89a63", "stroke-width": st.main ? 1.2 : 0.8, "stroke-dasharray": "4,4", opacity: 0.6 }));
  }
  for (const br of vdata.bridges) {
    gRoads.appendChild(el("use", { href: "#glyph-bridge", transform: `translate(${br.x.toFixed(1)},${br.y.toFixed(1)}) scale(1.4)` }));
  }

  const gBuildings = el("g", { id: "llayer-buildings" });
  for (const b of vdata.buildings) {
    const t = `translate(${b.cx.toFixed(1)},${b.cy.toFixed(1)}) rotate(${b.angle.toFixed(1)})`;
    if (b.kind === "well") {
      gBuildings.appendChild(el("circle", { cx: b.cx, cy: b.cy, r: 4.5, fill: "#8d8275", stroke: "#3b2a18", "stroke-width": 1 }));
      gBuildings.appendChild(el("circle", { cx: b.cx, cy: b.cy, r: 2.3, fill: "#2c3e50" }));
      continue;
    }
    const r = el("rect", {
      x: -b.w / 2, y: -b.h / 2, width: b.w, height: b.h,
      fill: b.color, stroke: "#3b2a18", "stroke-width": 1, transform: t, rx: b.kind === "stall" ? 1 : 1.5,
    });
    gBuildings.appendChild(r);
    if (b.kind === "church") {
      // transept crossing the nave, plus a spire with a small cross on top
      gBuildings.appendChild(el("rect", { x: -b.w * 1.1, y: -b.h * 0.18, width: b.w * 2.2, height: b.h * 0.36, fill: b.color, stroke: "#3b2a18", "stroke-width": 1, transform: t }));
      const spireH = b.h * 0.55;
      gBuildings.appendChild(el("path", { d: `M ${-b.w * 0.5} ${-b.h / 2} L 0 ${-b.h / 2 - spireH} L ${b.w * 0.5} ${-b.h / 2} Z`, fill: "#8f8678", stroke: "#3b2a18", "stroke-width": 0.8, transform: t }));
      gBuildings.appendChild(el("path", { d: `M 0 ${-b.h / 2 - spireH - 7} L 0 ${-b.h / 2 - spireH + 1} M -3 ${-b.h / 2 - spireH - 4} L 3 ${-b.h / 2 - spireH - 4}`, stroke: "#3b2a18", "stroke-width": 1.4, transform: t }));
    } else if (b.kind === "keep") {
      const towerSize = b.w * 0.22;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        gBuildings.appendChild(el("rect", {
          x: -towerSize / 2, y: -towerSize / 2, width: towerSize, height: towerSize, fill: "#59544a", stroke: "#2e2820", "stroke-width": 0.8,
          transform: `translate(${(b.cx + sx * b.w * 0.46).toFixed(1)},${(b.cy + sy * b.h * 0.42).toFixed(1)}) rotate(${b.angle.toFixed(1)})`,
        }));
      }
      gBuildings.appendChild(el("path", { d: `M ${-b.w * 0.18} ${-b.h / 2} L 0 ${-b.h / 2 - b.h * 0.4} L ${b.w * 0.18} ${-b.h / 2} Z`, fill: "#4a4538", stroke: "#2e2820", "stroke-width": 0.8, transform: t }));
    } else if (b.kind === "stall") {
      gBuildings.appendChild(el("path", { d: `M ${-b.w / 2 - 1.5} ${-b.h / 2} L 0 ${-b.h / 2 - 5} L ${b.w / 2 + 1.5} ${-b.h / 2} Z`, fill: b.color, opacity: 0.85, transform: t }));
    }
  }

  const gFoliage = el("g", { id: "llayer-foliage" });
  for (const t of vdata.trees) {
    gFoliage.appendChild(el("use", { href: "#glyph-tree", transform: `translate(${t.x.toFixed(1)},${t.y.toFixed(1)}) scale(${(t.scale * 1.3).toFixed(2)})` }));
  }

  svg.appendChild(gGround);
  svg.appendChild(gPlots);
  svg.appendChild(gWalls);
  svg.appendChild(gRoads);
  if (lparams.foliageTop) {
    svg.appendChild(gBuildings);
    svg.appendChild(gFoliage);
  } else {
    svg.appendChild(gFoliage);
    svg.appendChild(gBuildings);
  }

  applyLocalLayerVisibility();
}
function applyLocalLayerVisibility() {
  document.querySelectorAll("#localLayerChecks input[data-llayer]").forEach(cb => {
    const g = document.getElementById("llayer-" + cb.dataset.llayer);
    if (g) g.style.display = cb.checked ? "" : "none";
  });
}
