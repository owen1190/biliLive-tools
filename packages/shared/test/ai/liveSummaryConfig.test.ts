import { describe, expect, it } from "vitest";

import { resolveLiveSummaryPrompt } from "../../src/ai/liveSummaryConfig.js";

describe("live summary config helpers", () => {
  it("prefers a one-time custom prompt when provided", () => {
    const prompt = resolveLiveSummaryPrompt(
      {
        prompt: "global prompt",
        promptOverrides: [
          {
            streamer: "主播A",
            roomId: "123",
            prompt: "room prompt",
          },
        ],
      } as any,
      {
        streamer: "主播A",
        roomId: "123",
      },
      " custom prompt ",
    );

    expect(prompt).toBe("custom prompt");
  });

  it("ignores an empty one-time custom prompt", () => {
    const prompt = resolveLiveSummaryPrompt(
      {
        prompt: "global prompt",
        promptOverrides: [
          {
            streamer: "主播A",
            roomId: "123",
            prompt: "room prompt",
          },
        ],
      } as any,
      {
        streamer: "主播A",
        roomId: "123",
      },
      "   ",
    );

    expect(prompt).toBe("room prompt");
  });

  it("prefers a room-specific prompt override", () => {
    const prompt = resolveLiveSummaryPrompt(
      {
        prompt: "global prompt",
        promptOverrides: [
          {
            streamer: "主播A",
            roomId: "123",
            prompt: "room prompt",
          },
          {
            streamer: "主播A",
            prompt: "streamer prompt",
          },
        ],
      } as any,
      {
        streamer: "主播A",
        roomId: "123",
      },
    );

    expect(prompt).toBe("room prompt");
  });

  it("falls back to a streamer-specific prompt when the room does not match", () => {
    const prompt = resolveLiveSummaryPrompt(
      {
        prompt: "global prompt",
        promptOverrides: [
          {
            streamer: "主播B",
            roomId: "123",
            prompt: "wrong room prompt",
          },
          {
            streamer: "主播B",
            prompt: "streamer prompt",
          },
        ],
      } as any,
      {
        streamer: "主播B",
        roomId: "999",
      },
    );

    expect(prompt).toBe("streamer prompt");
  });

  it("ignores prompt overrides with empty prompt content", () => {
    const prompt = resolveLiveSummaryPrompt(
      {
        prompt: "global prompt",
        promptOverrides: [
          {
            streamer: "主播C",
            roomId: "123",
            prompt: "   ",
          },
          {
            streamer: "主播C",
            prompt: "streamer prompt",
          },
        ],
      } as any,
      {
        streamer: "主播C",
        roomId: "123",
      },
    );

    expect(prompt).toBe("streamer prompt");
  });

  it("falls back to the global prompt when no override matches", () => {
    const prompt = resolveLiveSummaryPrompt(
      {
        prompt: "global prompt",
        promptOverrides: [
          {
            streamer: "主播D",
            prompt: "streamer prompt",
          },
        ],
      } as any,
      {
        streamer: "主播E",
        roomId: "999",
      },
    );

    expect(prompt).toBe("global prompt");
  });

  it("trims matcher values before matching", () => {
    const prompt = resolveLiveSummaryPrompt(
      {
        prompt: "global prompt",
        promptOverrides: [
          {
            streamer: " 主播F ",
            roomId: " 123 ",
            prompt: "room prompt",
          },
        ],
      } as any,
      {
        streamer: "主播F",
        roomId: "123",
      },
    );

    expect(prompt).toBe("room prompt");
  });
});
