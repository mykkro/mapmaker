// ===================================================================================
// MapMaker — World generation orchestrator. Calls each layer module in dependency
// order (terrain -> hydrology -> settlements -> roads -> caves) and assembles the
// single `data` object consumed by the renderer, village generator, and 3D view.
// ===================================================================================
function generateWorld(params) {
  const terrain = generateTerrain(params);
  const hydrology = generateHydrology(terrain, params);
  const settlements = placeSettlements(terrain, hydrology, params);
  const roads = buildRoads(terrain, hydrology, settlements);
  const caves = generateCaves(terrain, hydrology, settlements, params);

  return {
    cols: terrain.cols, rows: terrain.rows,
    seaLevel: terrain.seaLevel, mountainLevel: terrain.mountainLevel,
    height: terrain.height, moisture: terrain.moisture, temperature: terrain.temperature,
    biome: terrain.biome, isWater: terrain.isWater, isOcean: terrain.isOcean, isLake: terrain.isLake,
    isRiver: hydrology.isRiver, riverFlow: hydrology.riverFlow, rivers: hydrology.rivers,
    isCliff: hydrology.isCliff, ponds: hydrology.ponds,
    settlements, roads, caves,
    rng: terrain.rng,
  };
}
