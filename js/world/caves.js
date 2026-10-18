// ===================================================================================
// MapMaker — Caves layer: sparse POIs scattered on cliff/mountain rock faces, spaced
// apart and kept clear of settlements.
// ===================================================================================
function generateCaves(terrain, hydrology, settlements, params) {
  const { cols, rows, n, height, biome, rng } = terrain;
  const { isCliff } = hydrology;
  const mountainPct = params.mountainPct;

  const caves = [];
  {
    const caveCandidates = [];
    for (let i = 0; i < n; i++) {
      if (isCliff[i] || biome[i] === "mountain" || biome[i] === "snowpeak") caveCandidates.push(i);
    }
    caveCandidates.sort((a, b) => height[b] - height[a]);
    const caveTarget = clamp(Math.round((mountainPct / 100) * Math.sqrt(cols * rows) / 7), 2, 16);
    const minDist = Math.max(4, Math.sqrt((cols * rows) / Math.max(1, caveTarget)) * 0.5);
    for (const ci of caveCandidates) {
      if (caves.length >= caveTarget) break;
      if (rng() > 0.4) continue;
      const cx = ci % cols, cy = Math.floor(ci / cols);
      let ok = true;
      for (const c of caves) { if (Math.hypot(cx - c.x, cy - c.y) < minDist) { ok = false; break; } }
      if (ok) {
        for (const s of settlements) { if (Math.hypot(cx - s.x, cy - s.y) < 4) { ok = false; break; } }
      }
      if (ok) caves.push({ x: cx, y: cy });
    }
  }

  return caves;
}
