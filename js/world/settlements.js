// ===================================================================================
// MapMaker — Settlements layer: fantasy name generator + suitability-scored placement
// (flat land, fresh water nearby, comfortable biome/elevation) with tier assignment.
// ===================================================================================
function genNames(count, rng) {
  const pre = ["Thorn", "Ash", "Oak", "Red", "Stone", "River", "Black", "White", "Green", "Hollow", "Dun", "Iron", "Silver", "Wolf", "Raven", "Elder", "Fen", "Brack", "Hart", "Mire"];
  const suf = ["mere", "ford", "vale", "haven", "wick", "burg", "shire", "moor", "dale", "crest", "hollow", "bridge", "watch", "reach", "fell", "holt"];
  const used = new Set(); const out = [];
  let tries = 0;
  while (out.length < count && tries < count * 30) {
    tries++;
    const name = pre[Math.floor(rng() * pre.length)] + suf[Math.floor(rng() * suf.length)];
    if (used.has(name)) continue;
    used.add(name); out.push(name);
  }
  while (out.length < count) out.push("Settlement " + (out.length + 1));
  return out;
}

function placeSettlements(terrain, hydrology, params) {
  const { cols, rows, height, biome, isWater, rng, baseSeed } = terrain;
  const { isRiver } = hydrology;
  const settleCount = params.settleCount;

  const settlements = [];
  {
    const scores = [];
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const i = idx(x, y, cols);
        if (isWater[i] || biome[i] === "mountain" || biome[i] === "snowpeak") continue;
        const hL = height[idx(x - 1, y, cols)], hR = height[idx(x + 1, y, cols)];
        const hU = height[idx(x, y - 1, cols)], hD = height[idx(x, y + 1, cols)];
        const slope = Math.max(Math.abs(hL - hR), Math.abs(hU - hD));
        let waterNear = false;
        for (let dy = -2; dy <= 2 && !waterNear; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
            if (isWater[idx(xx, yy, cols)] || isRiver[idx(xx, yy, cols)]) { waterNear = true; break; }
          }
        }
        let score = (1 - slope * 6) * 2;
        score += waterNear ? 2.2 : 0;
        score -= Math.abs(height[i] - 0.38) * 1.4;
        score -= (biome[i] === "desert" || biome[i] === "tundra" || biome[i] === "swamp") ? 1.0 : 0;
        score += (rng() - 0.5) * 0.6;
        scores.push({ i, x, y, score, waterNear });
      }
    }
    scores.sort((a, b) => b.score - a.score);
    const minDist = Math.max(3, Math.sqrt((cols * rows) / Math.max(1, settleCount)) * 0.55);
    const names = genNames(settleCount, mulberry32(baseSeed ^ 0x27d4eb2f));
    let picked = 0;
    for (const s of scores) {
      if (picked >= settleCount) break;
      let ok = true;
      for (const o of settlements) {
        if (Math.hypot(s.x - o.x, s.y - o.y) < minDist) { ok = false; break; }
      }
      if (!ok) continue;
      settlements.push({ x: s.x, y: s.y, score: s.score, waterNear: s.waterNear, name: names[picked], id: picked });
      picked++;
    }
    settlements.sort((a, b) => b.score - a.score);
    settlements.forEach((s, rank) => {
      const frac = rank / Math.max(1, settlements.length - 1);
      if (rank === 0 && settlements.length >= 6) s.tier = "capital";
      else s.tier = frac < 0.15 ? "city" : frac < 0.5 ? "town" : "village";
      s.sizeFactor = rng(); // 0..1 variety roll within the tier (population/footprint size)
    });
  }

  return settlements;
}
