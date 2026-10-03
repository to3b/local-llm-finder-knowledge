// Side-effect module: expands the bundled catalogue, then swaps in the validated live sheet in browsers.
import { GPUs, MODELS } from './data.js';
import { EXTRA_GPUS } from './gpu-extra.js';
import { EXTRA_MODELS } from './model-extra.js';
import { applyModelCalibrations } from './model-calibrations.js';
import { loadLiveCatalogue } from './live-data.js';

function appendUnique(target, additions) {
  const ids = new Set(target.map(item => item.id));
  const names = new Set(target.map(item => item.name.toLowerCase()));
  for (const item of additions) {
    if (ids.has(item.id) || names.has(item.name.toLowerCase())) continue;
    target.push(item);
    ids.add(item.id);
    names.add(item.name.toLowerCase());
  }
}

function disambiguateGpuNames() {
  const counts = new Map();
  for (const gpu of GPUs) {
    const key = gpu.name.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const gpu of GPUs) {
    if ((counts.get(gpu.name.toLowerCase()) || 0) > 1) gpu.name = `${gpu.name} ${gpu.vramGB}GB`;
  }
}

appendUnique(GPUs, EXTRA_GPUS);
appendUnique(MODELS, EXTRA_MODELS);
applyModelCalibrations(MODELS);

// In browsers this awaits the published sheet before app.js/journeys.js build their datalists.
// Node/CI skips the network path and continues to exercise the bundled known-good fallback.
await loadLiveCatalogue({ GPUs, MODELS });

disambiguateGpuNames();
GPUs.sort((a, b) => a.name.localeCompare(b.name));
MODELS.sort((a, b) => a.name.localeCompare(b.name));
