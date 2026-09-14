/** Per-model options shared by all OpenAI-compatible LLM tasks. Safe to use in the renderer. */
export interface LLMModelConfig {
  maxTokens?: number;
  enableThinking?: boolean;
  extraBody?: Record<string, unknown>;
}

const reservedFields = new Set([
  "model",
  "messages",
  "stream",
  "apiKey",
  "api_key",
  "baseURL",
  "base_url",
  "__proto__",
  "constructor",
  "prototype",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateCap(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error("最大输出 tokens 必须为正整数");
  }
}

export function normalizeLLMModelConfig(value: unknown): LLMModelConfig {
  if (value === undefined) return {};
  if (!isObject(value)) throw new Error("LLM 模型配置必须是对象");
  const result: LLMModelConfig = {};
  if (value.maxTokens !== undefined && value.maxTokens !== null) {
    validateCap(value.maxTokens);
    result.maxTokens = value.maxTokens as number;
  }
  if (value.enableThinking !== undefined && value.enableThinking !== null) {
    if (typeof value.enableThinking !== "boolean")
      throw new Error("思考模式必须为开启、关闭或供应商默认");
    result.enableThinking = value.enableThinking;
  }
  if (value.extraBody !== undefined) {
    if (!isObject(value.extraBody)) throw new Error("高级请求参数必须为 JSON 对象");
    for (const key of Object.keys(value.extraBody)) {
      if (reservedFields.has(key)) throw new Error(`高级请求参数不允许设置 ${key}`);
    }
    const capFields = ["max_tokens", "max_completion_tokens"].filter(
      (key) => value.extraBody![key] !== undefined,
    );
    if (capFields.length > 1 || (capFields.length > 0 && result.maxTokens !== undefined)) {
      throw new Error("输出额度重复配置：请只设置最大输出 tokens 或高级参数中的一个输出额度字段");
    }
    for (const key of capFields) {
      if (value.extraBody[key] !== null) validateCap(value.extraBody[key]);
    }
    if (Object.keys(value.extraBody).length > 0) result.extraBody = { ...value.extraBody };
  }
  return result;
}

export function resolveLLMThinkingParams(
  provider: string,
  baseURL: string | undefined,
  enabled: boolean | undefined,
): Record<string, unknown> {
  if (enabled === undefined) return {};
  const host = baseURL ? new URL(baseURL).hostname : "";
  if (host === "api.deepseek.com") return { thinking: { type: enabled ? "enabled" : "disabled" } };
  if (
    (provider === "aliyun" && !baseURL) ||
    host === "dashscope.aliyuncs.com" ||
    host === "token-plan.cn-beijing.maas.aliyuncs.com"
  ) {
    return { enable_thinking: enabled };
  }
  throw new Error(
    "当前接口无法自动设置思考模式，请选择供应商默认，并在高级请求参数中填写供应商支持的思考参数",
  );
}
