// ===================================================================================
// MapMaker — Application controller: reads UI params, drives world/village
// (re)generation, wires up all toolbar/slider/panel events, and handles rename/export.
// ===================================================================================
let currentVillageData = null;
let currentSettlement = null;

function readParams() {
  return {
    seed: document.getElementById("seedInput").value || "seed",
    cols: parseInt(document.getElementById("cols").value, 10),
    rows: Math.round(parseInt(document.getElementById("cols").value, 10) * (IMG_H / IMG_W)),
    seaLevelPct: parseInt(document.getElementById("seaLevel").value, 10),
    mountainPct: parseInt(document.getElementById("mountain").value, 10),
    islandMode: document.getElementById("islandMode").checked,
    tempBias: parseInt(document.getElementById("temp").value, 10),
    moistPct: parseInt(document.getElementById("moist").value, 10),
    forestPct: parseInt(document.getElementById("forest").value, 10),
    riverCount: parseInt(document.getElementById("rivers").value, 10),
    pondCount: parseInt(document.getElementById("ponds").value, 10),
    settleCount: parseInt(document.getElementById("settle").value, 10),
    curvePct: parseInt(document.getElementById("curve").value, 10),
  };
}

function updateLabels() {
  const map = {
    cols: "v_cols", seaLevel: "v_seaLevel", mountain: "v_mountain", temp: "v_temp",
    moist: "v_moist", forest: "v_forest", rivers: "v_rivers", ponds: "v_ponds", settle: "v_settle", curve: "v_curve",
  };
  for (const id in map) {
    document.getElementById(map[id]).textContent = document.getElementById(id).value;
  }
  document.getElementById("v_bdens").textContent = document.getElementById("bdens").value;
  document.getElementById("v_fdens").textContent = document.getElementById("fdens").value;
  document.getElementById("v_scurve").textContent = document.getElementById("scurve").value;
}

function regenerateWorld() {
  const loading = document.getElementById("loading");
  loading.classList.add("show");
  setTimeout(() => {
    const params = readParams();
    const data = generateWorld(params);
    data.seedStr = params.seed;
    worldState = { data, params };
    renderWorld(data, params);
    loading.classList.remove("show");
  }, 10);
}

function openVillage(settlementId) {
  const s = worldState.data.settlements.find(x => x.id === settlementId);
  if (!s) return;
  currentSettlement = s;
  document.getElementById("villagePanel").classList.add("open");
  updateVillageHeader();
  rerollVillage();
}
function updateVillageHeader() {
  if (!currentSettlement) return;
  const s = currentSettlement;
  document.getElementById("villageName").textContent = s.name;
  document.getElementById("villageTag").textContent = s.tier[0].toUpperCase() + s.tier.slice(1) + " · " + BIOME_LABELS[worldState.data.biome[idx(s.x, s.y, worldState.data.cols)]];
}
function renameSettlement(s) {
  const next = prompt("Rename settlement:", s.name);
  if (!next || !next.trim() || next.trim() === s.name) return;
  s.name = next.trim().slice(0, 40);
  const label = document.querySelector(`#layer-labels text[data-id="${s.id}"]`);
  if (label) label.textContent = s.name;
  if (currentSettlement === s) updateVillageHeader();
}
function rerollVillage() {
  if (!currentSettlement) return;
  const lparams = {
    bdens: parseInt(document.getElementById("bdens").value, 10),
    fdens: parseInt(document.getElementById("fdens").value, 10),
    scurve: parseInt(document.getElementById("scurve").value, 10),
    foliageTop: document.getElementById("foliageTop").checked,
  };
  const ctx = computeNeighborContext(currentSettlement, worldState.data);
  currentVillageData = generateVillage(currentSettlement, worldState.data, lparams, ctx);
  renderVillage(currentVillageData, lparams);
}

function exportSvg(svgEl, filename) {
  const clone = svgEl.cloneNode(true);
  clone.setAttribute("xmlns", SVG_NS);
  const src = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([src], { type: "image/svg+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function init() {
  updateLabels();
  const sliders = ["cols", "seaLevel", "mountain", "temp", "moist", "forest", "rivers", "ponds", "settle", "curve"];
  sliders.forEach(id => {
    document.getElementById(id).addEventListener("input", updateLabels);
    document.getElementById(id).addEventListener("change", regenerateWorld);
  });
  document.getElementById("islandMode").addEventListener("change", regenerateWorld);
  document.getElementById("seedInput").addEventListener("change", regenerateWorld);
  document.getElementById("btnRegen").addEventListener("click", regenerateWorld);
  document.getElementById("btnRandomSeed").addEventListener("click", () => {
    document.getElementById("seedInput").value = Math.random().toString(36).slice(2, 10);
    regenerateWorld();
  });
  document.getElementById("btnExportWorld").addEventListener("click", () => exportSvg(document.getElementById("world"), "mapmaker-world.svg"));

  document.querySelectorAll("#layerChecks input[data-layer]").forEach(cb => cb.addEventListener("change", applyLayerVisibility));

  document.getElementById("world").addEventListener("click", e => {
    const marker = e.target.closest(".settlement-marker");
    if (marker) openVillage(parseInt(marker.dataset.id, 10));
  });
  document.getElementById("world").addEventListener("dblclick", e => {
    const marker = e.target.closest(".settlement-marker");
    const label = e.target.closest("text[data-id]");
    const id = marker ? parseInt(marker.dataset.id, 10) : label ? parseInt(label.dataset.id, 10) : null;
    if (id == null) return;
    const s = worldState.data.settlements.find(x => x.id === id);
    if (s) { e.preventDefault(); renameSettlement(s); }
  });

  document.getElementById("btnCloseVillage").addEventListener("click", () => {
    document.getElementById("villagePanel").classList.remove("open");
    currentSettlement = null;
  });
  ["bdens", "fdens", "scurve"].forEach(id => {
    document.getElementById(id).addEventListener("input", updateLabels);
    document.getElementById(id).addEventListener("change", rerollVillage);
  });
  document.getElementById("foliageTop").addEventListener("change", rerollVillage);
  document.getElementById("btnRerollVillage").addEventListener("click", rerollVillage);
  document.getElementById("btnExportVillage").addEventListener("click", () => exportSvg(document.getElementById("village"), (currentSettlement ? currentSettlement.name : "village") + ".svg"));
  document.querySelectorAll("#localLayerChecks input[data-llayer]").forEach(cb => cb.addEventListener("change", applyLocalLayerVisibility));
  document.getElementById("btnRenameVillage").addEventListener("click", () => { if (currentSettlement) renameSettlement(currentSettlement); });

  document.getElementById("btn3D").addEventListener("click", () => {
    if (worldState) window.Mapmaker3D.openWorld(worldState.data, worldState.params);
  });
  document.getElementById("btnVillage3D").addEventListener("click", () => {
    if (currentVillageData) window.Mapmaker3D.openVillage(currentVillageData);
  });

  setupPanZoom();
  regenerateWorld();
}

document.addEventListener("DOMContentLoaded", init);
