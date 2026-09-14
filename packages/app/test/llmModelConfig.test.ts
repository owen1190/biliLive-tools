// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getLLMModelForm, buildLLMModelConfig } from "../src/renderer/src/utils/llmModelConfig";

describe("LLM model editor configuration", () => {
  it("round-trips saved caps, a false thinking switch and advanced JSON", () => {
    const config = {
      language: "zh",
      llm: { maxTokens: 12000, enableThinking: false, extraBody: { reasoning_effort: "low" } },
    };
    const form = getLLMModelForm(config);
    expect(form).toMatchObject({ maxTokens: 12000, thinkingMode: "disabled" });
    expect(JSON.parse(form.extraBodyText)).toEqual({ reasoning_effort: "low" });
    expect(buildLLMModelConfig(config, form)).toEqual(config);
  });

  it("keeps older and ASR configurations unchanged when LLM controls use supplier defaults", () => {
    const config = { language: "zh", hotwords: ["主播"] };
    const form = getLLMModelForm(config);
    expect(form).toEqual({ maxTokens: null, thinkingMode: "default", extraBodyText: "" });
    expect(buildLLMModelConfig(config, form)).toEqual(config);
  });

  it("can clear saved LLM settings without deleting ASR options or mutating the original", () => {
    const config = { hotwords: ["主播"], llm: { maxTokens: 12000, enableThinking: true } };
    const saved = buildLLMModelConfig(config, {
      maxTokens: null,
      thinkingMode: "default",
      extraBodyText: "",
    });
    expect(saved).toEqual({ hotwords: ["主播"] });
    expect(config.llm).toEqual({ maxTokens: 12000, enableThinking: true });
  });

  it.each([
    "not JSON",
    "[]",
    "null",
    "123",
    '{"messages": []}',
    '{"max_tokens": 8000, "max_completion_tokens": 9000}',
  ])("rejects invalid advanced JSON when saving: %s", (extraBodyText) => {
    expect(() =>
      buildLLMModelConfig({}, { maxTokens: null, thinkingMode: "default", extraBodyText }),
    ).toThrow();
  });
});
