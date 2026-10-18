// ===================================================================================
// MapMaker — Roads layer: Minimum Spanning Tree over settlements, then a cost-aware
// grid pathfind (A*-ish) per edge that prefers flat/dry land, with bridge markers
// wherever the resulting path crosses water or a river.
// ===================================================================================
function buildRoads(terrain, hydrology, settlements) {
  const { cols, rows, n, height, mountainLevel, isOcean, isLake, isWater } = terrain;
  const { isRiver } = hydrology;

  const roads = []; // {points:[{x,y}], bridges:[{x,y}]}
  if (settlements.length > 1) {
    const N = settlements.length;
    const inMST = new Array(N).fill(false);
    const dist = new Array(N).fill(Infinity);
    const parent = new Array(N).fill(-1);
    dist[0] = 0;
    for (let k = 0; k < N; k++) {
      let u = -1, best = Infinity;
      for (let i = 0; i < N; i++) if (!inMST[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u === -1) break;
      inMST[u] = true;
      for (let v = 0; v < N; v++) {
        if (inMST[v]) continue;
        const d = Math.hypot(settlements[u].x - settlements[v].x, settlements[u].y - settlements[v].y);
        if (d < dist[v]) { dist[v] = d; parent[v] = u; }
      }
    }
    const mountainLevelCached = mountainLevel;
    function terrainCost(toI) {
      if (isOcean[toI]) return 45;
      if (isLake[toI]) return 18;
      if (isRiver[toI]) return 3.2;
      if (height[toI] > mountainLevelCached) return 1 + (height[toI] - mountainLevelCached) * 22;
      return 1;
    }
    function findPath(sx, sy, tx, ty) {
      const target = idx(tx, ty, cols);
      const dist2 = new Float32Array(n).fill(Infinity);
      const prev = new Int32Array(n).fill(-1);
      const visited = new Uint8Array(n);
      const startI = idx(sx, sy, cols);
      dist2[startI] = 0;
      // simple binary heap: [f, i]
      const heap = [[0, startI]];
      function heapPush(item) { heap.push(item); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } }
      function heapPop() {
        const top = heap[0]; const last = heap.pop();
        if (heap.length) { heap[0] = last; let c = 0; while (true) { let l = c * 2 + 1, r = c * 2 + 2, s = c; if (l < heap.length && heap[l][0] < heap[s][0]) s = l; if (r < heap.length && heap[r][0] < heap[s][0]) s = r; if (s === c) break; [heap[s], heap[c]] = [heap[c], heap[s]]; c = s; } }
        return top;
      }
      const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
      const STEP = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
      while (heap.length) {
        const [, u] = heapPop();
        if (visited[u]) continue;
        visited[u] = 1;
        if (u === target) break;
        const ux = u % cols, uy = Math.floor(u / cols);
        for (let d = 0; d < 8; d++) {
          const vx = ux + DX[d], vy = uy + DY[d];
          if (vx < 0 || vy < 0 || vx >= cols || vy >= rows) continue;
          const v = idx(vx, vy, cols);
          if (visited[v]) continue;
          const cost = STEP[d] * terrainCost(v);
          const nd = dist2[u] + cost;
          if (nd < dist2[v]) {
            dist2[v] = nd; prev[v] = u;
            const h = nd + Math.hypot(vx - tx, vy - ty) * 0.9;
            heapPush([h, v]);
          }
        }
      }
      if (dist2[target] === Infinity) return null;
      const pts = [];
      let cur = target;
      while (cur !== -1) { pts.push({ x: cur % cols, y: Math.floor(cur / cols) }); cur = prev[cur]; }
      pts.reverse();
      return pts;
    }
    for (let v = 1; v < N; v++) {
      const u = parent[v];
      if (u === -1) continue;
      const path = findPath(settlements[u].x, settlements[u].y, settlements[v].x, settlements[v].y);
      if (!path) continue;
      const bridges = [];
      for (let k = 1; k < path.length; k++) {
        const p = path[k], pi = idx(p.x, p.y, cols);
        const prevP = path[k - 1], prevI = idx(prevP.x, prevP.y, cols);
        if ((isRiver[pi] || isWater[pi]) && !(isRiver[prevI] || isWater[prevI])) {
          bridges.push({ x: p.x, y: p.y });
        }
      }
      roads.push({ points: path, bridges });
    }
  }

  return roads;
}
