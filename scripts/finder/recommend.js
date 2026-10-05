import './catalog-extra.js';
import { MODELS } from './data.js';

export const USE_CASES = {
  chat: 'general chat', coding: 'coding', reasoning: 'reasoning',
  writing: 'creative writing', longContext: 'long-context work'
};

const QUANTIZATIONS = new Set(['auto', 'Q4_K_M', 'Q5_K_M', 'Q8_0']);

export const MEMORY_UNITS = Object.freeze({ decimalGB: 1e9, GiB: 2 ** 30 });
export const RUNTIME_ALLOWANCE_GB = 0.9; // Decimal GB; a planning allowance, not a measurement.

// All values below are planning estimates, not device/model benchmarks.
// Keep the calculation pure so a future data source can replace these inputs.
export function estimate(model, quant, hardware, contextK) {
  // Catalogue weight/cache inputs use decimal GB. Installed memory budgets use
  // GiB. Convert once, and decide fit before rounding any displayed figure.
  const weightsBytes = quant.weightsGB * MEMORY_UNITS.decimalGB;
  const cacheBytes = model.kvGBPer1K * contextK * MEMORY_UNITS.decimalGB;
  const requiredBytes = weightsBytes + RUNTIME_ALLOWANCE_GB * MEMORY_UNITS.decimalGB + cacheBytes;
  const requiredGiB = requiredBytes / MEMORY_UNITS.GiB;
  const hostRAMGiB = (quant.weightsGB + 4) * MEMORY_UNITS.decimalGB / MEMORY_UNITS.GiB;
  const reserveGiB = +(Math.max(.15, Math.min(1.5, hardware.vramGB * .03))).toFixed(2);
  const headroomGiB = hardware.vramGB - requiredGiB - reserveGiB;
  const fits = headroomGiB >= 0;
  // Bandwidth proxy with a gentle cap: real inference depends on more than bandwidth.
  // MoE profiles can provide an active-weight hint; cap the benefit because attention,
  // shared layers, runtime overhead and expert routing still cost time.
  const bandwidth = hardware.bandwidthGBs ?? 500;
  const hintedSpeedWeights = quant.speedWeightsGB ?? quant.weightsGB;
  const throughputWeightsGB = Math.max(quant.weightsGB * .22, hintedSpeedWeights);
  const nominal = 20 * (16 / throughputWeightsGB) * Math.pow(bandwidth / 850, 0.72);
  const contextPenalty = Math.max(0.7, 1 - contextK / 320);
  const middle = Math.max(1, nominal * contextPenalty);
  return {
    requiredGiB, hostRAMGiB, reserveGiB, headroomGiB,
    // Compatibility aliases for existing callers; all allocation metrics are GiB.
    requiredGB: requiredGiB, hostRAMGB: hostRAMGiB, reserveGB: reserveGiB,
    requiredBytes, cacheBytes, requiredDecimalGB: requiredBytes / MEMORY_UNITS.decimalGB,
    cacheType: model.cacheType || 'planning',
    memoryFit: !fits ? 'exceeds' : headroomGiB < 0.5 ? 'tight' : 'fits',
    speedLow: Math.round(middle * .85), speedHigh: Math.round(middle * 1.15),
    // Host RAM is advisory: memory-mapped loaders can behave differently.
    fits,
    ramAdvisory: hostRAMGiB <= hardware.ramGB
  };
}

function taskQuality(model, useCases, primaryUse) {
  const unique = [...new Set(useCases)];
  if (!primaryUse || !unique.includes(primaryUse) || unique.length === 1) {
    return unique.reduce((total, key) => total + model.quality[key], 0) / unique.length;
  }

  // Keep the default interaction simple: the declared main job receives most of
  // the weight, while every secondary job still has a meaningful influence.
  const secondary = unique.filter(key => key !== primaryUse);
  const secondaryAverage = secondary.reduce((total, key) => total + model.quality[key], 0) / secondary.length;
  return model.quality[primaryUse] * .65 + secondaryAverage * .35;
}

export function recommend({
  hardware,
  useCases,
  primaryUse = null,
  preference,
  minSpeed,
  contextK,
  quantization = 'auto',
  maxWeightsGB = null,
  family = null
}, models = MODELS) {
  if (!hardware || !Number.isFinite(hardware.vramGB) || hardware.vramGB < 2 ||
      !Number.isFinite(hardware.ramGB) || hardware.ramGB < 4 ||
      !Array.isArray(useCases) || !useCases.length || useCases.some(key => !USE_CASES[key]) ||
      (primaryUse !== null && (!USE_CASES[primaryUse] || !useCases.includes(primaryUse))) ||
      !Number.isInteger(preference) || preference < 1 || preference > 5 ||
      !Number.isFinite(minSpeed) || minSpeed < 1 || ![4, 8, 16, 32, 64].includes(contextK) ||
      !QUANTIZATIONS.has(quantization) ||
      (maxWeightsGB !== null && (!Number.isFinite(maxWeightsGB) || maxWeightsGB <= 0)) ||
      (family !== null && typeof family !== 'string')) {
    throw new Error('Choose valid hardware and requirements to find matches.');
  }

  // A value of 1 means the user has not requested a hard speed floor. Speed still
  // contributes to ranking against a neutral 15 tok/s reference, but slower models
  // are not silently excluded. Any value above 1 is an explicit minimum.
  const hasSpeedFloor = minSpeed > 1;
  const speedReference = hasSpeedFloor ? minSpeed : 15;

  const excluded = { context: 0, memory: 0, filters: 0 };
  const eligible = [];
  for (const model of models) {
    if (family && model.family !== family) { excluded.filters++; continue; }
    if (model.contextK < contextK) { excluded.context++; continue; }

    const quantCandidates = model.quantizations.filter(quant => {
      if (quantization !== 'auto' && quant.name !== quantization) return false;
      if (maxWeightsGB !== null && quant.weightsGB > maxWeightsGB) return false;
      return true;
    });
    if (!quantCandidates.length) { excluded.filters++; continue; }

    const options = quantCandidates.map(quant => {
      const metrics = estimate(model, quant, hardware, contextK);
      const quality = Math.min(100, Math.round(taskQuality(model, useCases, primaryUse) + (quant.qualityBonus ?? 0)));
      // The five-stop control should have distinct meanings. Balanced still trades
      // speed and quality; Stronger and especially Strongest become quality-first,
      // with speed acting mainly as a tie-break unless the user sets a hard floor.
      const qualityWeight = [.24, .46, .70, .90, .98][preference - 1];
      const speedKnown = hardware.speedKnown !== false && hardware.mode !== 'unsure';
      let speedUtility;
      if (!speedKnown) {
        const sizeProxy = Math.min(1, 7 / quant.weightsGB);
        speedUtility = preference === 1 ? .62 + .38 * sizeProxy
          : preference === 2 ? .74 + .26 * sizeProxy
          : .82;
      } else {
        const ratio = metrics.speedLow / Math.max(1, speedReference);
        if (ratio < 1) speedUtility = Math.max(0, .72 * ratio);
        else {
          const headroom = Math.min(1, Math.log2(ratio) / 2.5);
          speedUtility = .72 + .28 * headroom;
        }
      }
      const rank = qualityWeight * quality / 100 + (1 - qualityWeight) * speedUtility;
      // VRAM alone tells us fit, not device-specific speed. No explicit floor means
      // known-GPU models remain eligible and speed only affects their ranking.
      const meetsSpeed = speedKnown ? (hasSpeedFloor ? metrics.speedLow >= minSpeed : true) : null;
      return { model, quant, quality, ...metrics, rank, meetsSpeed };
    }).filter(option => option.fits);

    if (!options.length) { excluded.memory++; continue; }
    // One quantization per model. A qualifying option wins over a slower one.
    options.sort((a, b) => Number(b.meetsSpeed !== false) - Number(a.meetsSpeed !== false) || b.rank - a.rank);
    eligible.push(options[0]);
  }

  eligible.sort((a, b) => b.rank - a.rank || b.quality - a.quality || a.quant.weightsGB - b.quant.weightsGB);
  const qualifying = eligible.filter(item => item.meetsSpeed !== false);
  const bestTaskFit = Math.max(0, ...qualifying.map(item => item.quality));
  // Avoid filling the shortlist with tiny but weak models when stronger ones
  // already offer a reasonable speed/quality balance. Speed-first allows a wider range.
  const taskFloor = bestTaskFit - (preference <= 2 ? 28 : preference === 3 ? 18 : 14);
  return {
    matches: qualifying.filter(item => item.quality >= taskFloor).slice(0, 5),
    slower: eligible.filter(item => item.meetsSpeed === false).slice(0, 5),
    // Complete one-quantization-per-model list for the optional catalogue.
    // Includes slower and weaker task fits, but never models that fail memory/context/filters.
    catalog: eligible,
    excluded,
    considered: models.length
  };
}

// Load the decision-flow layer only in a browser. Keeping it out of Node makes
// the recommendation module remain usable as a pure, testable calculation API.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // Do not impose a hidden speed floor. Advanced users can opt into one.
  const speedInput = document.querySelector('#speed-input');
  if (speedInput && (speedInput.value === '15' || speedInput.value === '10')) speedInput.value = '1';

  if (!document.querySelector('link[data-local-llm-palette]')) {
    const palette = document.createElement('link');
    palette.rel = 'stylesheet';
    palette.href = './palette.css';
    palette.dataset.localLlmPalette = 'true';
    document.head.append(palette);
  }

  queueMicrotask(() => {
    import('./journeys.js?v=20261005-memory-1');
  });
}


