/* ============ 单价与成本折算（人民币，内部以"微元"整数存储） ============
 * 1 元 = 1,000,000 微元，比"分"更细，单次极小调用也不会被舍成 0。
 * DeepSeek 按 token、CosyVoice 按输入字符。单价可被 env.PRICING（JSON）覆盖，调价不改代码。
 * ===================================================================== */

const MICRO_PER_YUAN = 1_000_000;

const DEFAULT_PRICING = {
  /* DeepSeek flash，单位：元 / 百万 tokens，分高峰/闲时 */
  deepseek: {
    inputMiss: { peak: 2, off: 1 },
    inputHit:  { peak: 0.04, off: 0.02 },
    output:    { peak: 8, off: 4 }
  },
  /* CosyVoice flash，单位：元 / 万字符 */
  cosyvoice: { per10kChars: 0.8 }
};

function pricingFor(env) {
  const p = structuredClone(DEFAULT_PRICING);
  try {
    const raw = env.PRICING ? JSON.parse(env.PRICING) : null;
    if (raw) {
      if (raw.deepseek) Object.assign(p.deepseek, raw.deepseek);
      if (raw.cosyvoice) Object.assign(p.cosyvoice, raw.cosyvoice);
    }
  } catch (_) {}
  return p;
}

/* DeepSeek 成本（微元）。兼容上游两种缓存命中字段。 */
export function deepseekMicro(env, usage, peak) {
  const p = pricingFor(env).deepseek;
  const totalIn = Number(usage?.prompt_tokens) || 0;
  const hit = Number(usage?.prompt_cache_hit_tokens) ||
    Number(usage?.prompt_tokens_details?.cached_tokens) || 0;
  const safeHit = Math.min(hit, totalIn);
  const miss = Math.max(0, totalIn - safeHit);
  const out = Number(usage?.completion_tokens) || 0;
  const tier = peak ? 'peak' : 'off';
  const yuan =
    (miss / 1_000_000) * p.inputMiss[tier] +
    (safeHit / 1_000_000) * p.inputHit[tier] +
    (out / 1_000_000) * p.output[tier];
  return Math.max(0, Math.round(yuan * MICRO_PER_YUAN));
}

/* CosyVoice 成本（微元），按输入字符数 */
export function cosyvoiceMicro(env, characters) {
  const p = pricingFor(env).cosyvoice;
  const yuan = (Number(characters) || 0) / 10_000 * p.per10kChars;
  return Math.max(0, Math.round(yuan * MICRO_PER_YUAN));
}

/* DeepSeek 单笔"最高可能成本"（微元），用于调用前原子预留。
 * 输入按字符数保守上界（每字符最多 1 token），输出按 max_tokens 或默认 2048，
 * 一律取高峰、输入未命中（最贵）口径。预留偏大，结算时按实际用量退回差额。 */
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
export function maxDeepseekMicro(env, input) {
  const p = pricingFor(env).deepseek;
  const chars = Array.from(JSON.stringify(input?.messages || '')).length;
  const maxInTokens = chars;
  const asked = Number(input?.max_tokens);
  const maxOutTokens = asked > 0 ? asked : DEFAULT_MAX_OUTPUT_TOKENS;
  const yuan =
    (maxInTokens / 1_000_000) * p.inputMiss.peak +
    (maxOutTokens / 1_000_000) * p.output.peak;
  return Math.max(1, Math.round(yuan * MICRO_PER_YUAN));
}
