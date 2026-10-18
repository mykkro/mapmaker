// ===================================================================================
// MapMaker — Hydrology & rock-feature layer: rivers (steepest-descent flow), cliffs
// (slope edges), gorges (river segments cutting through high terrain), and
// ponds/lakes (closed-depression basin filling). Mutates terrain.isWater/isLake/biome
// in place for cells that become new lake/pond water.
// ===================================================================================
function generateHydrology(terrain, params) {
  const { cols, rows, n, height, isWater, isLake, biome, rng } = terrain;
  const riverCount = params.riverCount;

  // ---- Rivers: steepest-descent flow from high sources down to water ----
  const isRiver = new Uint8Array(n);
  const riverFlow = new Float32Array(n);
  const rivers = []; // array of {points:[{x,y}], flow}
  {
    const candidates = [];
    for (let i = 0; i < n; i++) {
      if (!isWater[i] && height[i] > 0.62) candidates.push(i);
    }
    candidates.sort((a, b) => height[b] - height[a]);
    const chosen = [];
    const minSep = Math.max(3, Math.min(cols, rows) / Math.max(4, Math.sqrt(riverCount) * 2.2));
    for (const c of candidates) {
      if (chosen.length >= riverCount) break;
      const cx = c % cols, cy = Math.floor(c / cols);
      let ok = true;
      for (const o of chosen) {
        const ox = o % cols, oy = Math.floor(o / cols);
        if (Math.hypot(cx - ox, cy - oy) < minSep) { ok = false; break; }
      }
      if (ok) chosen.push(c);
    }
    const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
    for (const src of chosen) {
      let x = src % cols, y = Math.floor(src / cols);
      const path = [{ x, y }];
      const visited = new Set([idx(x, y, cols)]);
      let steps = 0, maxSteps = cols + rows;
      while (steps++ < maxSteps) {
        const curI = idx(x, y, cols);
        if (isWater[curI] && path.length > 1) break;
        let best = -1, bestH = height[curI];
        for (let d = 0; d < 8; d++) {
          const nx2 = x + DX[d], ny2 = y + DY[d];
          if (nx2 < 0 || ny2 < 0 || nx2 >= cols || ny2 >= rows) continue;
          const ni = idx(nx2, ny2, cols);
          if (visited.has(ni)) continue;
          if (height[ni] < bestH || (isWater[ni] && height[ni] <= bestH + 0.02)) { bestH = height[ni]; best = ni; }
        }
        if (best === -1) break; // local minimum / dead end -> pond
        x = best % cols; y = Math.floor(best / cols);
        visited.add(best);
        path.push({ x, y });
        riverFlow[best] += 1;
        if (isWater[best]) break;
      }
      if (path.length > 3) {
        for (const p of path) isRiver[idx(p.x, p.y, cols)] = 1;
        rivers.push({ points: path });
        // if it dead-ended on land, mark as a small pond/lake
        const last = path[path.length - 1];
        const li = idx(last.x, last.y, cols);
        if (!isWater[li]) { isLake[li] = 1; isWater[li] = 1; biome[li] = "lake"; }
      }
    }
  }

  // ---- Cliffs: steep slope edges (mountain rims, plateaus, coastal bluffs) ----
  const isCliff = new Uint8Array(n);
  const CLIFF_THRESH = 0.16;
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const i = idx(x, y, cols);
      if (isWater[i]) continue;
      const hL = height[idx(x - 1, y, cols)], hR = height[idx(x + 1, y, cols)];
      const hU = height[idx(x, y - 1, cols)], hD = height[idx(x, y + 1, cols)];
      const slope = Math.max(Math.abs(hL - hR), Math.abs(hU - hD));
      if (slope > CLIFF_THRESH) isCliff[i] = 1;
    }
  }

  // ---- Gorges: river segments cutting through terrain much higher than the riverbed ----
  const GORGE_THRESH = 0.13;
  for (const r of rivers) {
    for (const p of r.points) {
      const i = idx(p.x, p.y, cols);
      let maxNeighbor = -Infinity;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = p.x + dx, yy = p.y + dy;
          if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
          const ni = idx(xx, yy, cols);
          if (isRiver[ni] || isWater[ni]) continue;
          if (height[ni] > maxNeighbor) maxNeighbor = height[ni];
        }
      }
      p.gorge = maxNeighbor !== -Infinity && (maxNeighbor - height[i]) > GORGE_THRESH;
    }
  }

  // ---- Ponds / lakes: fill closed terrain depressions (priority-flood basin growth) ----
  const ponds = [];
  {
    const pondTarget = Math.max(0, Math.round(params.pondCount != null ? params.pondCount : 6));
    const minima = [];
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const i = idx(x, y, cols);
        if (isWater[i]) continue;
        let isMin = true;
        for (let dy = -1; dy <= 1 && isMin; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const ni = idx(x + dx, y + dy, cols);
            if (height[ni] < height[i]) { isMin = false; break; }
          }
        }
        if (isMin) minima.push(i);
      }
    }
    for (let k = minima.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); const t = minima[k]; minima[k] = minima[j]; minima[j] = t; }
    const maxBasin = Math.max(12, Math.round(cols * rows * 0.0025));
    let attempts = 0;
    for (const start of minima) {
      if (ponds.length >= pondTarget || attempts > pondTarget * 12) break;
      attempts++;
      if (isWater[start]) continue;
      let tooClose = false;
      for (const p of ponds) { if (Math.hypot((start % cols) - p.cx, Math.floor(start / cols) - p.cy) < 8) { tooClose = true; break; } }
      if (tooClose) continue;
      const targetSize = 10 + Math.floor(rng() * (maxBasin - 10));
      const maxRise = 0.035 + rng() * 0.03; // basin depth budget: stop at the natural rim instead
                                             // of climbing an open slope just to hit a cell quota
      const visited = new Uint8Array(n);
      const heap = [[height[start], start]];
      function push(item) { heap.push(item); let c = heap.length - 1; while (c > 0) { const p2 = (c - 1) >> 1; if (heap[p2][0] <= heap[c][0]) break; [heap[p2], heap[c]] = [heap[c], heap[p2]]; c = p2; } }
      function pop() { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; while (true) { let l = c * 2 + 1, r = c * 2 + 2, s = c; if (l < heap.length && heap[l][0] < heap[s][0]) s = l; if (r < heap.length && heap[r][0] < heap[s][0]) s = r; if (s === c) break;[heap[s], heap[c]] = [heap[c], heap[s]]; c = s; } } return top; }
      visited[start] = 1;
      const included = [];
      let waterLevel = -Infinity, aborted = false;
      const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
      while (heap.length && included.length < targetSize) {
        const [h, i] = pop();
        if (isWater[i]) { aborted = true; break; }
        // Pops come out in non-decreasing height order, so once the next cheapest frontier
        // cell overshoots the depth budget, every remaining candidate does too — this is the
        // basin's natural rim/saddle point, and growing further would spill onto open terrain.
        if (h - height[start] > maxRise) break;
        const x = i % cols, y = Math.floor(i / cols);
        if (x <= 0 || y <= 0 || x >= cols - 1 || y >= rows - 1) { aborted = true; break; }
        waterLevel = Math.max(waterLevel, h);
        included.push(i);
        for (let d = 0; d < 8; d++) {
          const ni = idx(x + DX[d], y + DY[d], cols);
          if (!visited[ni]) { visited[ni] = 1; push([height[ni], ni]); }
        }
      }
      if (aborted || included.length < 8) continue;
      let cxSum = 0, cySum = 0;
      for (const ci of included) { isWater[ci] = 1; isLake[ci] = 1; biome[ci] = "lake"; cxSum += ci % cols; cySum += Math.floor(ci / cols); }
      const cx = cxSum / included.length, cy = cySum / included.length;
      let radius = 1;
      for (const ci of included) radius = Math.max(radius, Math.hypot((ci % cols) - cx, Math.floor(ci / cols) - cy));
      ponds.push({ cx, cy, level: waterLevel, radius: radius + 1, cells: included });
    }
  }

  return { isRiver, riverFlow, rivers, isCliff, ponds };
}
