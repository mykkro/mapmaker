// ===================================================================================
// MapMaker — Shared SVG helpers: element creation, Catmull-Rom path smoothing, and
// the <defs> glyph library (trees, mountains, settlement icons, bridges, caves) used
// by both the world and village renderers.
// ===================================================================================
const SVG_NS = "http://www.w3.org/2000/svg";

function el(tag, attrs) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function catmullRomPath(points, scaleX, scaleY) {
  if (points.length < 2) return "";
  const pts = points.map(p => [p.x * scaleX, p.y * scaleY]);
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} `;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} `;
  }
  return d;
}

function ensureDefs(svg) {
  let defs = svg.querySelector("defs");
  if (defs) return defs;
  defs = el("defs", {});
  const tree = el("g", { id: "glyph-tree" });
  tree.appendChild(el("circle", { cx: 0, cy: -3, r: 3.4, fill: "#2e6b3e", stroke: "#1d4527", "stroke-width": 0.4 }));
  tree.appendChild(el("rect", { x: -0.6, y: -1, width: 1.2, height: 2.6, fill: "#5a3d26" }));
  defs.appendChild(tree);

  const mountain = el("g", { id: "glyph-mountain" });
  mountain.appendChild(el("path", { d: "M -7 4 L -2 -6 L 1 -1 L 3 -4 L 7 4 Z", fill: "#8a7d70", stroke: "#5f564c", "stroke-width": 0.5 }));
  mountain.appendChild(el("path", { d: "M -2 -6 L 0 -2.5 L 1.6 -3.3 L 1 -1 Z", fill: "#f3f3f3" }));
  defs.appendChild(mountain);

  const houseV = el("g", { id: "glyph-village" });
  houseV.appendChild(el("circle", { r: 4, fill: "#caa24c", stroke: "#50341a", "stroke-width": 1 }));
  defs.appendChild(houseV);
  const houseT = el("g", { id: "glyph-town" });
  houseT.appendChild(el("path", { d: "M0,-6 L6,0 L4,0 L4,6 L-4,6 L-4,0 L-6,0 Z", fill: "#d9a441", stroke: "#50341a", "stroke-width": 1 }));
  defs.appendChild(houseT);
  const houseC = el("g", { id: "glyph-city" });
  houseC.appendChild(el("path", { d: "M0,-9 L7,-1 L5,-1 L5,8 L-5,8 L-5,-1 L-7,-1 Z", fill: "#e9532b", stroke: "#50341a", "stroke-width": 1 }));
  houseC.appendChild(el("circle", { cx: 0, cy: -9, r: 1.6, fill: "#e9532b", stroke: "#50341a", "stroke-width": 0.8 }));
  defs.appendChild(houseC);
  const houseCap = el("g", { id: "glyph-capital" });
  houseCap.appendChild(el("rect", { x: -9, y: -3, width: 18, height: 11, fill: "#c0392b", stroke: "#3d2410", "stroke-width": 1 }));
  houseCap.appendChild(el("path", { d: "M0,-13 L8,-3 L-8,-3 Z", fill: "#c0392b", stroke: "#3d2410", "stroke-width": 1 }));
  houseCap.appendChild(el("rect", { x: -9, y: -3, width: 3.2, height: 5, fill: "#8d2a1e", stroke: "#3d2410", "stroke-width": 0.6 }));
  houseCap.appendChild(el("rect", { x: 5.8, y: -3, width: 3.2, height: 5, fill: "#8d2a1e", stroke: "#3d2410", "stroke-width": 0.6 }));
  houseCap.appendChild(el("circle", { cx: 0, cy: -13, r: 1.8, fill: "#f2c744", stroke: "#3d2410", "stroke-width": 0.6 }));
  defs.appendChild(houseCap);

  const bridge = el("g", { id: "glyph-bridge" });
  bridge.appendChild(el("rect", { x: -6, y: -2.2, width: 12, height: 4.4, rx: 1, fill: "#9c7b4f", stroke: "#4a3418", "stroke-width": 0.7 }));
  defs.appendChild(bridge);

  const cave = el("g", { id: "glyph-cave" });
  cave.appendChild(el("path", { d: "M -5 4 L -5 0 A 5 5 0 0 1 5 0 L 5 4 Z", fill: "#1b1410", stroke: "#4a3418", "stroke-width": 1 }));
  cave.appendChild(el("path", { d: "M -3.2 3 L -3.2 0.5 A 3.2 3.2 0 0 1 3.2 0.5 L 3.2 3 Z", fill: "#000" }));
  defs.appendChild(cave);

  svg.appendChild(defs);
  return defs;
}
