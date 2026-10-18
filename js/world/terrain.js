// ===================================================================================
// MapMaker — Terrain layer: height map (continent shape + ridged mountains), sea/lake
// classification, moisture & temperature fields, and biome assignment.
// ===================================================================================
function generateTerrain(params) {
  const { seed, cols, rows, seaLevelPct, mountainPct, islandMode, tempBias, moistPct } = params;
  const baseSeed = hashSeed(seed);
  const rng = mulberry32(baseSeed);
  const noiseH = makeNoise2D(mulberry32(baseSeed ^ 0x9e3779b9));
  const noiseR = makeNoise2D(mulberry32(baseSeed ^ 0x85ebca6b));
  const noiseM = makeNoise2D(mulberry32(baseSeed ^ 0xc2b2ae35));

  const n = cols * rows;
  const height = new Float32Array(n);
  const mountainIntensity = mountainPct / 100;

  // Pass 1: base continent/island shape, normalized to 0..1 BEFORE any mountain contribution
  // so the mountain slider's amplitude isn't erased by a later global renormalization.
  let hmin = Infinity, hmax = -Infinity;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const nx = x / cols - 0.5, ny = y / rows - 0.5;
      let e = fbm(noiseH, x * 0.035, y * 0.035, 5, 2.0, 0.5); // -ish 1..1
      e = (e + 1) / 2;
      if (islandMode) {
        const d = Math.sqrt(nx * nx + ny * ny) * 2.15;
        e -= smoothstep(0.55, 1.15, d) * 1.15;
      }
      height[idx(x, y, cols)] = e;
      if (e < hmin) hmin = e;
      if (e > hmax) hmax = e;
    }
  }
  for (let i = 0; i < n; i++) height[i] = clamp((height[i] - hmin) / (hmax - hmin), 0, 1);

  // Pass 2: add ridged mountain relief on top of the normalized base — a direct additive boost
  // (not renormalized again) so mountainPct visibly controls how much terrain becomes peaks.
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = idx(x, y, cols);
      const base = height[i];
      const ridge = Math.abs(fbm(noiseR, x * 0.09, y * 0.09, 4, 2.0, 0.5));
      const boost = Math.pow(1 - ridge, 3) * mountainIntensity * 0.65 * smoothstep(0.46, 0.82, base);
      height[i] = clamp(base + boost, 0, 1);
    }
  }

  const seaLevel = seaLevelPct / 100;
  const mountainLevel = clamp(0.95 - mountainIntensity * 0.29, 0.66, 0.95);

  // Water classification: ocean = connected to border via flood fill, else lake
  const isWater = new Uint8Array(n);
  for (let i = 0; i < n; i++) isWater[i] = height[i] < seaLevel ? 1 : 0;
  const isOcean = new Uint8Array(n);
  {
    const qx = new Int32Array(n), qy = new Int32Array(n);
    let head = 0, tail = 0;
    for (let x = 0; x < cols; x++) {
      for (const y of [0, rows - 1]) { const i = idx(x, y, cols); if (isWater[i] && !isOcean[i]) { isOcean[i] = 1; qx[tail] = x; qy[tail] = y; tail++; } }
    }
    for (let y = 0; y < rows; y++) {
      for (const x of [0, cols - 1]) { const i = idx(x, y, cols); if (isWater[i] && !isOcean[i]) { isOcean[i] = 1; qx[tail] = x; qy[tail] = y; tail++; } }
    }
    const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
    while (head < tail) {
      const x = qx[head], y = qy[head]; head++;
      for (let d = 0; d < 4; d++) {
        const nx2 = x + DX[d], ny2 = y + DY[d];
        if (nx2 < 0 || ny2 < 0 || nx2 >= cols || ny2 >= rows) continue;
        const ni = idx(nx2, ny2, cols);
        if (isWater[ni] && !isOcean[ni]) { isOcean[ni] = 1; qx[tail] = nx2; qy[tail] = ny2; tail++; }
      }
    }
  }
  const isLake = new Uint8Array(n);
  for (let i = 0; i < n; i++) isLake[i] = isWater[i] && !isOcean[i] ? 1 : 0;

  // Multi-source BFS distance to water (for moisture)
  const waterDist = new Float32Array(n).fill(-1);
  {
    const qx = new Int32Array(n), qy = new Int32Array(n);
    let head = 0, tail = 0;
    for (let i = 0; i < n; i++) if (isWater[i]) { waterDist[i] = 0; qx[tail] = i % cols; qy[tail] = Math.floor(i / cols); tail++; }
    const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
    while (head < tail) {
      const x = qx[head], y = qy[head]; const i0 = idx(x, y, cols); head++;
      for (let d = 0; d < 8; d++) {
        const nx2 = x + DX[d], ny2 = y + DY[d];
        if (nx2 < 0 || ny2 < 0 || nx2 >= cols || ny2 >= rows) continue;
        const ni = idx(nx2, ny2, cols);
        if (waterDist[ni] === -1) { waterDist[ni] = waterDist[i0] + 1; qx[tail] = nx2; qy[tail] = ny2; tail++; }
      }
    }
  }
  const maxDistNorm = Math.max(cols, rows) * 0.22;

  const moisture = new Float32Array(n);
  const temperature = new Float32Array(n);
  const moistBias = (moistPct - 50) / 100;
  const tBiasN = tempBias / 100;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = idx(x, y, cols);
      const distBonus = 1 - clamp(waterDist[i] / maxDistNorm, 0, 1);
      const mn = (fbm(noiseM, x * 0.06, y * 0.06, 4, 2.0, 0.5) + 1) / 2;
      moisture[i] = clamp(distBonus * 0.55 + mn * 0.45 + moistBias * 0.5, 0, 1);
      const lat = Math.abs(y / rows - 0.5) * 2;
      temperature[i] = clamp(1 - lat * 0.85 - height[i] * 0.55 + tBiasN * 0.5, 0, 1);
    }
  }

  const biome = new Array(n);
  for (let i = 0; i < n; i++) {
    let b = classifyBiome(height[i], moisture[i], temperature[i], seaLevel, mountainLevel);
    if (b === "water") b = isOcean[i] ? "ocean" : "lake";
    biome[i] = b;
  }

  return {
    cols, rows, n, seaLevel, mountainLevel,
    height, moisture, temperature, biome,
    isWater, isOcean, isLake,
    rng, baseSeed,
  };
}
