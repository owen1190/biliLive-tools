import { beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));
vi.mock("../../src/utils/log.js", () => ({ default: logs }));

import {
  OpenAICompatibleLLM,
  resolveOpenAICompatibleBaseURL,
  resolveLLMThinkingParams,
} from "../../src/ai/llm/index.js";

// Replace only the SDK's network boundary; request serialization and response parsing stay real.
function mockTransport(
  baseURL: string,
  reply: Record<string, any> = {},
  modelConfig: Record<string, any> = {},
) {
  const llm = new OpenAICompatibleLLM({
    provider: "openai-compatible",
    apiKey: "test-key",
    baseURL,
    model: "deepseek-v4-pro",
    modelConfig,
  } as any);
  const requests: Record<string, any>[] = [];
  (llm as any).client.fetch = async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(init.body as string));
    return new Response(
      JSON.stringify({
        id: "test-completion",
        object: "chat.completion",
        created: 1,
        model: "deepseek-v4-pro",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "完整总结", ...reply.message },
            finish_reason: reply.finishReason || "stop",
          },
        ],
        usage: reply.usage || { prompt_tokens: 15834, completion_tokens: 100, total_tokens: 15934 },
      }),
      { headers: { "content-type": "application/json" } },
    );
  };
  return { llm, requests };
}

describe("DeepSeek LLM compatibility", () => {
  beforeEach(() => vi.clearAllMocks());

  it("honors the caller generation budget without a provider-specific floor", async () => {
    const { llm, requests } = mockTransport("https://api.deepseek.com");
    expect((await llm.sendMessage("直播转写", undefined, { maxTokens: 3000 })).content).toBe(
      "完整总结",
    );
    expect(requests[0].max_tokens).toBe(3000);
    expect(requests[0]).not.toHaveProperty("enable_thinking");
  });

  it("uses the DeepSeek thinking switch and preserves the cap when thinking is disabled", async () => {
    const { llm, requests } = mockTransport("https://api.deepseek.com/v1");
    await llm.sendMessage("直播转写", undefined, { maxTokens: 3000, enableThinking: false });
    expect(requests[0].thinking).toEqual({ type: "disabled" });
    expect(requests[0].max_tokens).toBe(3000);
    expect(requests[0]).not.toHaveProperty("enable_thinking");
  });

  it("preserves a larger caller budget when thinking is explicitly enabled", async () => {
    const { llm, requests } = mockTransport("https://api.deepseek.com");
    await llm.sendMessage("直播转写", undefined, { maxTokens: 32768, enableThinking: true });
    expect(requests[0].thinking).toEqual({ type: "enabled" });
    expect(requests[0].max_tokens).toBe(32768);
  });

  it("leaves the default thinking budget to DeepSeek when no cap is specified", async () => {
    const { llm, requests } = mockTransport("https://api.deepseek.com");
    await llm.sendMessage("直播转写");
    expect(requests[0]).not.toHaveProperty("max_tokens");
  });

  it("does not guess thinking parameters for another host, even with a DeepSeek model name", async () => {
    const { llm, requests } = mockTransport("https://api.deepseek.com.example.org/v1");
    await expect(
      llm.sendMessage("直播转写", undefined, { maxTokens: 3000, enableThinking: false }),
    ).rejects.toThrow(/高级请求参数/);
    expect(requests).toHaveLength(0);
  });

  it.each(["", "被截断的总结"])(
    "rejects length-limited responses rather than returning incomplete content: %s",
    async (content) => {
      const { llm } = mockTransport("https://api.deepseek.com", {
        message: { content, reasoning_content: "模型的内部推理" },
        finishReason: "length",
        usage: {
          prompt_tokens: 15834,
          completion_tokens: 3000,
          total_tokens: 18834,
          completion_tokens_details: { reasoning_tokens: 3000 },
        },
      });
      await expect(llm.sendMessage("直播转写", undefined, { maxTokens: 3000 })).rejects.toThrow(
        /输出.*上限/,
      );
      expect(logs.info).toHaveBeenCalledWith(
        "LLM 请求完成",
        expect.objectContaining({ reasoningLength: 7, reasoningTokens: 3000, maxTokens: 3000 }),
      );
      expect(JSON.stringify(logs.info.mock.calls)).not.toContain("模型的内部推理");
    },
  );

  it("does not substitute reasoning for an empty final answer even with a normal finish", async () => {
    const { llm } = mockTransport("https://api.deepseek.com", {
      message: { content: "", reasoning_content: "内部推理" },
    });
    await expect(llm.sendMessage("直播转写")).rejects.toThrow(/未返回正文/);
  });
});

describe("per-model LLM request configuration", () => {
  it("does not assume an Aliyun vendor's custom unknown endpoint supports enable_thinking", () => {
    expect(() => resolveLLMThinkingParams("aliyun", "https://proxy.example/v1", false)).toThrow(
      /高级请求参数/,
    );
  });

  it("uses the Aliyun dialect for its default endpoint in the editor", () => {
    expect(resolveLLMThinkingParams("aliyun", undefined, false)).toEqual({
      enable_thinking: false,
    });
  });
  it.each(["https://api.deepseek.com/v1", "https://other.example/v1"])(
    "uses the saved model cap at %s",
    async (baseURL) => {
      const { llm, requests } = mockTransport(baseURL, {}, { maxTokens: 12000 });
      await llm.sendMessage("直播转写", undefined, { temperature: 0.2 });
      expect(requests[0].max_tokens).toBe(12000);
    },
  );

  it("uses the saved model thinking switch with the official DeepSeek parameter", async () => {
    const { llm, requests } = mockTransport(
      "https://api.deepseek.com",
      {},
      { enableThinking: false },
    );
    await llm.sendMessage("直播转写");
    expect(requests[0].thinking).toEqual({ type: "disabled" });
    expect(requests[0]).not.toHaveProperty("enable_thinking");
  });

  it("recognizes the official Aliyun compatible endpoint", async () => {
    const { llm, requests } = mockTransport(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
      {},
      { enableThinking: false },
    );
    await llm.sendMessage("直播转写");
    expect(requests[0].enable_thinking).toBe(false);
    expect(requests[0]).not.toHaveProperty("thinking");
  });

  it("passes advanced provider parameters and a modern output-cap field without guessing", async () => {
    const { llm, requests } = mockTransport(
      "https://other.example/v1",
      {},
      { extraBody: { reasoning_effort: "low", max_completion_tokens: 10000, temperature: 0.4 } },
    );
    await llm.sendMessage("直播转写", undefined, { temperature: 0.2 });
    expect(requests[0]).toMatchObject({
      reasoning_effort: "low",
      max_completion_tokens: 10000,
      temperature: 0.4,
    });
    expect(requests[0]).not.toHaveProperty("max_tokens");
    expect(requests[0]).not.toHaveProperty("enable_thinking");
  });

  it("lets a per-call option override saved defaults without mutating them", async () => {
    const modelConfig = { maxTokens: 12000, enableThinking: true };
    const { llm, requests } = mockTransport("https://api.deepseek.com", {}, modelConfig);
    await llm.sendMessage("直播转写", undefined, { maxTokens: 2000, enableThinking: false });
    await llm.sendMessage("直播转写");
    expect(requests[0]).toMatchObject({ max_tokens: 2000, thinking: { type: "disabled" } });
    expect(requests[1]).toMatchObject({ max_tokens: 12000, thinking: { type: "enabled" } });
    expect(modelConfig).toEqual({ maxTokens: 12000, enableThinking: true });
  });

  it.each([0, -1, 1.5, Infinity, "12000"])(
    "rejects invalid saved caps before sending: %s",
    (maxTokens) => {
      expect(() => mockTransport("https://other.example/v1", {}, { maxTokens })).toThrow(/正整数/);
    },
  );

  it.each(["model", "messages", "stream", "api_key", "__proto__"])(
    "rejects a reserved advanced field: %s",
    (field) => {
      expect(() =>
        mockTransport(
          "https://other.example/v1",
          {},
          { extraBody: JSON.parse(`{"${field}": "invalid"}`) },
        ),
      ).toThrow(/不允许/);
    },
  );

  it("rejects two different output-cap fields instead of sending contradictory caps", () => {
    expect(() =>
      mockTransport(
        "https://other.example/v1",
        {},
        { maxTokens: 8000, extraBody: { max_completion_tokens: 12000 } },
      ),
    ).toThrow(/重复/);
  });
});

describe("OpenAI-compatible LLM config", () => {
  it("resolves provider-specific base URLs", () => {
    expect(resolveOpenAICompatibleBaseURL({ provider: "aliyun" })).toBe(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
    expect(resolveOpenAICompatibleBaseURL({ provider: "openai" })).toBeUndefined();
    expect(
      resolveOpenAICompatibleBaseURL({
        provider: "openai-compatible",
        baseURL: "https://example.com/v1",
      }),
    ).toBe("https://example.com/v1");
  });
});
