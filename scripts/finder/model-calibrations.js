// Evidence-backed adjustments to prototype ranking inputs.
// Keep this intentionally small: only override a value when direct source evidence
// contradicts an older planning input. Quant sizes are representative GGUF artifacts;
// different conversions can vary slightly.
export const MODEL_CALIBRATIONS = Object.freeze({
  'Mistral Medium 3.5 128B': {
    quality: { coding: 100 },
    source: 'https://huggingface.co/mistralai/Mistral-Medium-3.5-128B',
    verifiedAt: '2026-09-28',
    note: 'Mistral states Medium 3.5 supersedes its previous coding models and replaces Devstral 2 in Vibe.'
  },
  'Llama 3.1 8B Instruct': {
    quantWeightsGB: { Q4_K_M: 4.92, Q5_K_M: 5.73 },
    source: 'https://huggingface.co/lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF',
    verifiedAt: '2026-09-29',
    note: 'LM Studio Community lists the GGUF Q4_K_M artifact at 4.92 GB and Q5_K_M at 5.73 GB.'
  },
  'Qwen3 8B': {
    quantWeightsGB: { Q4_K_M: 5.03, Q5_K_M: 5.85 },
    source: 'https://huggingface.co/bartowski/Qwen_Qwen3-8B-GGUF',
    verifiedAt: '2026-09-29',
    note: 'Bartowski lists Q4_K_M at 5.03 GB and Q5_K_M at 5.85 GB for this GGUF build.'
  },
  'Qwen3 14B': {
    quantWeightsGB: { Q4_K_M: 9.00, Q5_K_M: 10.51 },
    source: 'https://huggingface.co/bartowski/Qwen_Qwen3-14B-GGUF',
    verifiedAt: '2026-09-29',
    note: 'Bartowski lists Q4_K_M at 9.00 GB and Q5_K_M at 10.51 GB for this GGUF build.'
  },
  'Qwen2.5 7B Instruct': {
    quantWeightsGB: { Q4_K_M: 4.68, Q5_K_M: 5.44 },
    source: 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF',
    verifiedAt: '2026-09-29',
    note: 'Bartowski lists Q4_K_M at 4.68 GB and Q5_K_M at 5.44 GB for this GGUF build.'
  },
  'Qwen2.5 14B Instruct': {
    quantWeightsGB: { Q4_K_M: 8.99, Q5_K_M: 10.51 },
    source: 'https://huggingface.co/bartowski/Qwen2.5-14B-Instruct-GGUF',
    verifiedAt: '2026-09-29',
    note: 'Bartowski lists Q4_K_M at 8.99 GB and Q5_K_M at 10.51 GB for this GGUF build.'
  },
  'Qwen2.5-Coder 7B': {
    quantWeightsGB: { Q4_K_M: 4.68, Q5_K_M: 5.44 },
    source: 'https://huggingface.co/bartowski/Qwen2.5-Coder-7B-Instruct-GGUF',
    verifiedAt: '2026-09-29',
    note: 'Bartowski lists Q4_K_M at 4.68 GB and Q5_K_M at 5.44 GB for this GGUF build.'
  },
  'Qwen2.5-Coder 14B': {
    quantWeightsGB: { Q4_K_M: 8.99, Q5_K_M: 10.51 },
    source: 'https://huggingface.co/bartowski/Qwen2.5-Coder-14B-Instruct-GGUF',
    verifiedAt: '2026-09-29',
    note: 'Bartowski lists Q4_K_M at 8.99 GB and Q5_K_M at 10.51 GB for this GGUF build.'
  },
  'DeepSeek-R1-Distill-Qwen-7B': {
    quantWeightsGB: { Q4_K_M: 4.68, Q5_K_M: 5.44 },
    source: 'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF',
    verifiedAt: '2026-09-29',
    note: 'Bartowski lists Q4_K_M at 4.68 GB and Q5_K_M at 5.44 GB for this GGUF build.'
  },
  'DeepSeek-R1-Distill-Qwen-14B': {
    quantWeightsGB: { Q4_K_M: 8.99, Q5_K_M: 10.51 },
    source: 'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF',
    verifiedAt: '2026-09-29',
    note: 'Bartowski lists Q4_K_M at 8.99 GB and Q5_K_M at 10.51 GB for this GGUF build.'
  },
  'Phi-3.5-mini-instruct': {
    quantWeightsGB: { Q4_K_M: 2.39, Q5_K_M: 2.82 },
    source: 'https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF',
    verifiedAt: '2026-09-29',
    note: 'Bartowski lists Q4_K_M at 2.39 GB and Q5_K_M at 2.82 GB for this GGUF build.'
  },
  'Mistral NeMo 12B': {
    quantWeightsGB: { Q4_K_M: 7.48, Q5_K_M: 8.73 },
    source: 'https://huggingface.co/bartowski/Mistral-Nemo-Instruct-2407-GGUF',
    verifiedAt: '2026-09-29',
    note: 'Bartowski lists Q4_K_M at 7.48 GB and Q5_K_M at 8.73 GB for this GGUF build.'
  },
  'LFM2.5 8B-A1B': {
    activeParametersB: 1.5,
    source: 'https://huggingface.co/LiquidAI/LFM2.5-8B-A1B',
    verifiedAt: '2026-09-28',
    note: 'Liquid AI lists 8.3B total parameters and 1.5B active parameters.'
  },
  'LFM2 24B-A2B': {
    activeParametersB: 2.3,
    source: 'https://huggingface.co/LiquidAI/LFM2-24B-A2B',
    verifiedAt: '2026-09-28',
    note: 'Liquid AI lists 24B total parameters and 2.3B active parameters.'
  }
});

function applyQuantWeightCalibration(model, quantWeightsGB) {
  for (const quant of model.quantizations) {
    const calibratedWeight = quantWeightsGB[quant.name];
    if (Number.isFinite(calibratedWeight) && calibratedWeight > 0) {
      quant.weightsGB = calibratedWeight;
    }
  }
}

function applyActiveWeightCalibration(model, activeParametersB) {
  model.activeParametersB = activeParametersB;
  const ratio = activeParametersB / model.parametersB;
  for (const quant of model.quantizations) {
    // Keep the same conservative floor used by the catalogue generator. This is a
    // speed-model hint only; memory still uses the full quantized weight footprint.
    quant.speedWeightsGB = +Math.max(.25, quant.weightsGB * ratio).toFixed(1);
  }
}

export function applyModelCalibrations(models) {
  for (const model of models) {
    const calibration = MODEL_CALIBRATIONS[model.name];
    if (!calibration) continue;
    if (calibration.quality) Object.assign(model.quality, calibration.quality);
    if (calibration.quantWeightsGB) {
      applyQuantWeightCalibration(model, calibration.quantWeightsGB);
    }
    if (Number.isFinite(calibration.activeParametersB)) {
      applyActiveWeightCalibration(model, calibration.activeParametersB);
    }
    model.calibration = calibration;
  }
  return models;
}
