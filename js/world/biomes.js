// ===================================================================================
// MapMaker — Biome layer: color palette, labels, and height/moisture/temperature
// classification into a biome name.
// ===================================================================================
const BIOME_COLORS = {
  ocean: [32, 72, 120], lake: [58, 128, 150], beach: [230, 213, 160],
  tundra: [177, 190, 163], snowpeak: [246, 248, 250], mountain: [142, 131, 119],
  desert: [223, 191, 122], taiga: [103, 140, 117], grassland: [139, 178, 99],
  forest: [73, 130, 78], jungle: [43, 107, 68], swamp: [95, 112, 83],
};
const BIOME_LABELS = {
  ocean: "Ocean", lake: "Lake", beach: "Beach", tundra: "Tundra", snowpeak: "Snow Peak",
  mountain: "Mountain", desert: "Desert", taiga: "Taiga", grassland: "Grassland",
  forest: "Forest", jungle: "Jungle", swamp: "Swamp",
};
window.BIOME_COLORS = BIOME_COLORS; // exposed for mapmaker3d.js

function classifyBiome(h, m, t, seaLevel, mountainLevel) {
  if (h < seaLevel) return "water"; // resolved to ocean/lake later via flood fill
  if (h < seaLevel + 0.02) return "beach";
  if (h > mountainLevel) return t < 0.3 ? "snowpeak" : "mountain";
  if (t < 0.14) return "tundra";
  if (m < 0.22) return t > 0.55 ? "desert" : "tundra";
  if (m < 0.40) return t < 0.3 ? "taiga" : "grassland";
  if (m < 0.66) return t < 0.3 ? "taiga" : "forest";
  if (m < 0.84) return t > 0.6 ? "jungle" : "forest";
  return h < seaLevel + 0.1 ? "swamp" : "jungle";
}
