// Publisher architecture-derived FP16 K/V planning inputs, not measurements.
// Keep these fallback values coordinated with the Models Sheet fields.
const profile = (checkpoint, layers) => Object.freeze({
  cacheType: 'f16',
  nativeContextTokens: 32768,
  memorySource: `https://huggingface.co/Qwen/${checkpoint}/blob/main/config.json`,
  memoryReviewedAt: '2026-10-05',
  // K and V, 8 KV heads, 128 values/head, 2 bytes/value; decimal GB / 1,000 tokens.
  kvGBPer1K: 2 * layers * 8 * 128 * 2 * 1000 / 1e9
});

export const REVIEWED_MEMORY_PROFILES = Object.freeze({
  'Qwen3 1.7B': profile('Qwen3-1.7B', 28),
  'Qwen3 4B': profile('Qwen3-4B', 36),
  'Qwen3 8B': profile('Qwen3-8B', 36),
  'Qwen3 14B': profile('Qwen3-14B', 40),
  'Qwen3 32B': profile('Qwen3-32B', 64)
});
