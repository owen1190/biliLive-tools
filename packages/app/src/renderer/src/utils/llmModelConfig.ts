import { normalizeLLMModelConfig } from "@biliLive-tools/shared/ai/llm/config.js";

export interface LLMModelForm {
  maxTokens: number | null;
  thinkingMode: "default" | "enabled" | "disabled";
  extraBodyText: string;
}

export function getLLMModelForm(config: Record<string, any> = {}): LLMModelForm {
  const llm = normalizeLLMModelConfig(config.llm);
  return {
    maxTokens: llm.maxTokens ?? null,
    thinkingMode:
      llm.enableThinking === undefined ? "default" : llm.enableThinking ? "enabled" : "disabled",
    extraBodyText: llm.extraBody ? JSON.stringify(llm.extraBody, null, 2) : "",
  };
}

export function buildLLMModelConfig(
  config: Record<string, any>,
  form: LLMModelForm,
): Record<string, any> {
  let extraBody: unknown;
  if (form.extraBodyText.trim()) {
    try {
      extraBody = JSON.parse(form.extraBodyText);
    } catch {
      throw new Error("高级请求参数不是有效的 JSON");
    }
  }
  const llm = normalizeLLMModelConfig({
    maxTokens: form.maxTokens,
    enableThinking: form.thinkingMode === "default" ? undefined : form.thinkingMode === "enabled",
    extraBody,
  });
  const saved = { ...config };
  if (Object.keys(llm).length > 0) saved.llm = llm;
  else delete saved.llm;
  return saved;
}
