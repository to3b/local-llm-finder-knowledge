// Loads the published Google Sheet in browsers while keeping the bundled catalogue as a safe fallback.
// Structural changes to these columns must be coordinated with the workbook and tests.
export const LIVE_SHEET = Object.freeze({
  base: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQrzDgQUmV8FDdt8HDHgg0YzpyJmR28TKqxRGhkg4kW2LK7-ncnt1z_nEKgg8MJecNxt0MGLcm0syD1/pub',
  modelsGid: '624018495',
  gpusGid: '1333766306',
  calibrationsGid: '500465526'
});

export const LIVE_DATA_STATE = {
  source: 'bundled',
  reason: 'Live sheet has not been loaded.',
  models: 0,
  gpus: 0
};

const MODEL_REQUIRED = [
  'Enabled', 'Model ID', 'Model Name', 'Parameters B', 'Family', 'Base Q4 GB',
  'Context K', 'KV GB / 1K', 'Chat', 'Coding', 'Reasoning', 'Writing', 'Long Context'
];
const GPU_REQUIRED = ['Enabled', 'GPU ID', 'GPU Name', 'VRAM GB', 'Bandwidth GB/s', 'Architecture'];
const CAL_REQUIRED = ['Model Name', 'Q4_K_M GB', 'Q5_K_M GB', 'Q8_0 GB', 'Active Params B', 'Chat', 'Coding', 'Reasoning', 'Writing', 'Long Context'];
const TASK_COLUMNS = Object.freeze({ Chat: 'chat', Coding: 'coding', Reasoning: 'reasoning', Writing: 'writing', 'Long Context': 'longContext' });

function sheetUrl(gid) {
  return `${LIVE_SHEET.base}?gid=${gid}&single=true&output=csv`;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') {
      row.push(cell.replace(/\r$/, ''));
      if (row.some(value => value.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ''));
    if (row.some(value => value.trim() !== '')) rows.push(row);
  }
  return rows;
}

function recordsFromCsv(text, required, label) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error(`${label} CSV has no data rows.`);
  const headers = rows[0].map(value => value.trim());
  for (const column of required) {
    if (!headers.includes(column)) throw new Error(`${label} is missing required column: ${column}`);
  }
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function enabled(value) {
  return /^(true|1|yes|y|on)$/i.test(String(value).trim());
}

function number(value, label, { min = -Infinity, max = Infinity, optional = false } = {}) {
  if (optional && String(value).trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return parsed;
}

function quant(name, weightsGB, qualityBonus = 0, activeRatio = null) {
  const speedWeightsGB = activeRatio ? +Math.max(.25, weightsGB * activeRatio).toFixed(1) : undefined;
  return {
    name,
    weightsGB,
    ...(qualityBonus ? { qualityBonus } : {}),
    ...(speedWeightsGB ? { speedWeightsGB } : {})
  };
}

export function buildModelsFromCsv(text) {
  const records = recordsFromCsv(text, MODEL_REQUIRED, 'Models');
  const models = [];
  const ids = new Set();
  const names = new Set();
  for (const row of records) {
    if (!enabled(row.Enabled)) continue;
    const id = row['Model ID'].trim();
    const name = row['Model Name'].trim();
    const family = row.Family.trim();
    if (!id || !name || !family) throw new Error('Enabled model rows require Model ID, Model Name and Family.');
    const nameKey = name.toLocaleLowerCase();
    if (ids.has(id)) throw new Error(`Duplicate Model ID: ${id}`);
    if (names.has(nameKey)) throw new Error(`Duplicate Model Name: ${name}`);
    ids.add(id);
    names.add(nameKey);

    const parametersB = number(row['Parameters B'], `${name} Parameters B`, { min: .01, max: 1000 });
    const activeParametersB = number(row['Active Params B'], `${name} Active Params B`, { min: .01, max: parametersB, optional: true });
    const baseGB = number(row['Base Q4 GB'], `${name} Base Q4 GB`, { min: .05, max: 1000 });
    const contextK = number(row['Context K'], `${name} Context K`, { min: 1, max: 1024 });
    const kvGBPer1K = number(row['KV GB / 1K'], `${name} KV GB / 1K`, { min: .001, max: 10 });
    const quality = Object.fromEntries(Object.entries(TASK_COLUMNS).map(([column, key]) => [key, number(row[column], `${name} ${column}`, { min: 0, max: 100 })]));
    const activeRatio = activeParametersB ? activeParametersB / parametersB : null;
    const q4 = +baseGB.toFixed(2);
    const q5 = +(baseGB * 1.22).toFixed(1);
    const q8 = +(baseGB * 1.85).toFixed(1);
    const licenseNote = row['License Note']?.trim() || null;

    models.push({
      id, name, parametersB,
      ...(activeParametersB ? { activeParametersB } : {}),
      family, contextK, kvGBPer1K, quality, licenseNote,
      quantizations: [quant('Q4_K_M', q4, 0, activeRatio), quant('Q5_K_M', q5, 2, activeRatio), ...(parametersB >= 27 ? [quant('Q8_0', q8, 4, activeRatio)] : [])],
      provenance: row.Provenance?.trim() || 'live-sheet'
    });
  }
  return models;
}

export function buildGpusFromCsv(text) {
  const records = recordsFromCsv(text, GPU_REQUIRED, 'GPUs');
  const gpus = [];
  const ids = new Set();
  const labels = new Set();
  for (const row of records) {
    if (!enabled(row.Enabled)) continue;
    const id = row['GPU ID'].trim();
    const name = row['GPU Name'].trim();
    const architecture = row.Architecture.trim();
    if (!id || !name || !architecture) throw new Error('Enabled GPU rows require GPU ID, GPU Name and Architecture.');
    if (ids.has(id)) throw new Error(`Duplicate GPU ID: ${id}`);
    ids.add(id);
    const vramGB = number(row['VRAM GB'], `${name} VRAM GB`, { min: 2, max: 512 });
    const bandwidthGBs = number(row['Bandwidth GB/s'], `${name} Bandwidth GB/s`, { min: 1, max: 10000 });
    const labelKey = `${name.toLocaleLowerCase()}|${vramGB}`;
    if (labels.has(labelKey)) throw new Error(`Duplicate GPU name/VRAM combination: ${name} ${vramGB}GB`);
    labels.add(labelKey);
    gpus.push({
      id, name, vramGB, bandwidthGBs, architecture,
      ...(row.Vendor?.trim() ? { vendor: row.Vendor.trim() } : {}),
      ...(row.Series?.trim() ? { series: row.Series.trim() } : {})
    });
  }
  return gpus;
}

function recalcSpeedWeights(model) {
  if (!model.activeParametersB || !model.parametersB) {
    for (const q of model.quantizations) delete q.speedWeightsGB;
    return;
  }
  const ratio = model.activeParametersB / model.parametersB;
  for (const q of model.quantizations) q.speedWeightsGB = +Math.max(.25, q.weightsGB * ratio).toFixed(1);
}

export function applySheetCalibrations(models, text) {
  const records = recordsFromCsv(text, CAL_REQUIRED, 'Quant Calibrations');
  const byName = new Map(models.map(model => [model.name.toLocaleLowerCase(), model]));
  for (const row of records) {
    if (/^hold$/i.test(row.Status?.trim() || '')) continue;
    const name = row['Model Name'].trim();
    if (!name) continue;
    const model = byName.get(name.toLocaleLowerCase());
    if (!model) throw new Error(`Calibration references unknown model: ${name}`);

    const active = number(row['Active Params B'], `${name} calibration Active Params B`, { min: .01, max: model.parametersB, optional: true });
    if (active !== null) model.activeParametersB = active;
    for (const [column, key] of Object.entries(TASK_COLUMNS)) {
      const score = number(row[column], `${name} calibration ${column}`, { min: 0, max: 100, optional: true });
      if (score !== null) model.quality[key] = score;
    }
    const quantColumns = { Q4_K_M: 'Q4_K_M GB', Q5_K_M: 'Q5_K_M GB', Q8_0: 'Q8_0 GB' };
    for (const [quantName, column] of Object.entries(quantColumns)) {
      const weights = number(row[column], `${name} calibration ${column}`, { min: .05, max: 1000, optional: true });
      if (weights === null) continue;
      const q = model.quantizations.find(item => item.name === quantName);
      if (q) q.weightsGB = weights;
    }
    recalcSpeedWeights(model);
    model.calibration = {
      source: row['Source URL']?.trim() || null,
      verifiedAt: row['Verified At']?.trim() || null,
      note: row.Note?.trim() || null
    };
  }
  return models;
}

export function validateCatalogue(models, gpus, { minModels = 130, minGpus = 135 } = {}) {
  if (models.length < minModels) throw new Error(`Live sheet has only ${models.length} enabled models; need at least ${minModels}.`);
  if (gpus.length < minGpus) throw new Error(`Live sheet has only ${gpus.length} enabled GPUs; need at least ${minGpus}.`);
  return true;
}

async function fetchCsv(gid, signal) {
  const response = await fetch(sheetUrl(gid), { signal, cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error(`Google Sheets returned HTTP ${response.status}.`);
  return response.text();
}

// Cache public CSVs only, never user selections. Re-parse and validate on every
// read so storage cannot bypass the same transactional data contract as fetch.
const CACHE_KEY = 'local-llm-finder:catalogue:v1';
const CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const CACHE_SOURCE = JSON.stringify(LIVE_SHEET);

function buildCatalogue([modelsText, gpusText, calibrationsText]) {
  const models = buildModelsFromCsv(modelsText);
  const gpus = buildGpusFromCsv(gpusText);
  applySheetCalibrations(models, calibrationsText);
  validateCatalogue(models, gpus);
  return { models, gpus };
}

function readCachedCatalogue() {
  try {
    const cached = JSON.parse(window.localStorage.getItem(CACHE_KEY));
    const age = Date.now() - cached?.savedAt;
    if (cached?.source !== CACHE_SOURCE || !Number.isFinite(age) || age < 0 || age >= CACHE_MAX_AGE_MS) return null;
    return buildCatalogue(cached.csv);
  } catch {
    // Corrupt data, disabled storage and quota/security errors must not block startup.
    return null;
  }
}

function acceptCatalogue({ models, gpus }, GPUs, MODELS, reason) {
  MODELS.splice(0, MODELS.length, ...models);
  GPUs.splice(0, GPUs.length, ...gpus);
  Object.assign(LIVE_DATA_STATE, { source: 'live-sheet', reason, models: models.length, gpus: gpus.length });
  return true;
}

export async function loadLiveCatalogue({ GPUs, MODELS, timeoutMs = 3500 } = {}) {
  if (typeof window === 'undefined' || typeof fetch !== 'function' || !Array.isArray(GPUs) || !Array.isArray(MODELS)) return false;
  const cached = readCachedCatalogue();
  if (cached) return acceptCatalogue(cached, GPUs, MODELS, 'Validated published Google Sheets data loaded from a recent cache.');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const csv = await Promise.all([
      fetchCsv(LIVE_SHEET.modelsGid, controller.signal),
      fetchCsv(LIVE_SHEET.gpusGid, controller.signal),
      fetchCsv(LIVE_SHEET.calibrationsGid, controller.signal)
    ]);
    const catalogue = buildCatalogue(csv);
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({ source: CACHE_SOURCE, savedAt: Date.now(), csv }));
    } catch { /* Storage is optional; valid network data remains usable. */ }
    return acceptCatalogue(catalogue, GPUs, MODELS, 'Validated published Google Sheets data loaded.');
  } catch (error) {
    controller.abort(); // Cancel sibling requests when any required tab fails.
    LIVE_DATA_STATE.source = 'bundled';
    LIVE_DATA_STATE.reason = error?.name === 'AbortError' ? 'Live sheet timed out.' : (error?.message || 'Live sheet could not be loaded.');
    console.warn('Local LLM Finder: using bundled catalogue fallback.', LIVE_DATA_STATE.reason);
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}
