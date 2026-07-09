import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockSummaryExportError extends Error {
    constructor(
      public errors: string[],
      public results: any[],
    ) {
      super(`总结已生成，但导出失败：${errors.join("；")}`);
      this.name = "SummaryExportError";
    }
  }

  return {
    MockSummaryExportError,
    createASRProvider: vi.fn(),
    exportSummaryToTargets: vi.fn(),
    getEnabledSummaryExportTargetNames: vi.fn(),
    getModel: vi.fn(),
    queryRecord: vi.fn(),
    listSameLiveRecords: vi.fn(),
    updateRecord: vi.fn(),
    sendNotify: vi.fn(),
    spawn: vi.fn(),
    ensureDir: vi.fn(),
    remove: vi.fn(),
    pathExists: vi.fn(),
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  };
});

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
}));

vi.mock("fs-extra", () => ({
  default: {
    ensureDir: mocks.ensureDir,
    remove: mocks.remove,
    pathExists: mocks.pathExists,
    writeFile: vi.fn(),
  },
}));

vi.mock("../../src/config.js", () => ({
  appConfig: {
    getAll: () => ({
      ffmpegPath: "/usr/bin/ffmpeg",
      ai: {
        vendors: [
          {
            id: "vendor-1",
            name: "Vendor",
            provider: "openai",
            apiKey: "key",
            baseURL: "https://example.com",
          },
        ],
        liveSummary: {
          enabled: true,
          asrModelId: "asr-1",
          llmModelId: "llm-1",
          prompt: "默认提示词",
          maxInputLength: 24000,
          saveTranscript: false,
          exportTargets: {
            feishu: {
              enabled: true,
              mode: "append",
              appId: "cli_xxx",
              appSecret: "secret",
              documentId: "doccnABC123",
            },
            notion: {
              enabled: true,
              mode: "append",
              token: "secret_xxx",
              pageId: "01234567-89ab-cdef-0123-456789abcdef",
            },
          },
        },
      },
    }),
  },
}));

vi.mock("../../src/db/index.js", () => ({
  recordHistoryService: {
    query: mocks.queryRecord,
    listSameLiveRecords: mocks.listSameLiveRecords,
    update: mocks.updateRecord,
  },
}));

vi.mock("../../src/ai/index.js", () => ({
  createASRProvider: mocks.createASRProvider,
  OpenAICompatibleLLM: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn().mockResolvedValue({
      content: "总结内容",
      usage: {},
    }),
  })),
}));

vi.mock("../../src/ai/summaryExport.js", () => ({
  SummaryExportError: mocks.MockSummaryExportError,
  exportSummaryToTargets: mocks.exportSummaryToTargets,
  getEnabledSummaryExportTargetNames: mocks.getEnabledSummaryExportTargetNames,
  buildLiveSummaryNotification: vi.fn((_input, results) => ({
    title: "直播总结已生成",
    desp: results.map((item: any) => `${item.name}：${item.url}`).join("\n"),
  })),
}));

vi.mock("../../src/musicDetector/utils.js", () => ({
  getModel: mocks.getModel,
}));

vi.mock("../../src/notify.js", () => ({
  sendNotify: mocks.sendNotify,
}));

vi.mock("../../src/utils/index.js", () => ({
  getTempPath: () => "/tmp/biliLive-tools",
  replaceExtName: (filePath: string, ext: string) => filePath.replace(/\.[^.]+$/, ext),
  uuid: () => "task-1",
}));

vi.mock("../../src/utils/log.js", () => ({
  default: mocks.logger,
}));

import { LiveSummaryTask } from "../../src/task/liveSummary.js";

describe("LiveSummaryTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathExists.mockResolvedValue(true);
    mocks.ensureDir.mockResolvedValue(undefined);
    mocks.remove.mockResolvedValue(undefined);
    mocks.spawn.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter;
        kill: () => void;
      };
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });
    mocks.createASRProvider.mockReturnValue({
      recognizeLocalFile: vi.fn().mockResolvedValue({
        text: "转写内容",
        segments: [],
      }),
    });
    mocks.getModel.mockReturnValue({
      vendorId: "vendor-1",
      modelName: "qwen",
    });
    mocks.queryRecord.mockReturnValue({
      id: 108,
      streamer_id: 1,
      live_id: undefined,
      record_start_time: 1781105107602,
      title: "直播标题",
      video_file: "/records/live.flv",
    });
    mocks.listSameLiveRecords.mockReturnValue([]);
    mocks.getEnabledSummaryExportTargetNames.mockReturnValue(["飞书文档", "Notion"]);
    mocks.exportSummaryToTargets.mockRejectedValue(
      new mocks.MockSummaryExportError(
        ["Notion：请先完整配置 Notion Token 和页面 ID/链接"],
        [
          {
            target: "feishu",
            name: "飞书文档",
            documentId: "doccnABC123",
            url: "https://feishu.cn/docx/doccnABC123",
            mode: "append",
          },
        ],
      ),
    );
  });

  it("still sends notifications with successful export links when another target fails", async () => {
    const task = new LiveSummaryTask({
      recordId: 108,
      videoFile: "/records/live.flv",
      title: "直播标题",
      streamer: "主播",
      roomId: "123",
      platform: "Bilibili",
      recordStartTime: 1781105107602,
    });

    await expect((task as any).run()).rejects.toThrow("Notion");

    expect(mocks.sendNotify).toHaveBeenCalledWith(
      "直播总结已生成",
      expect.stringContaining("https://feishu.cn/docx/doccnABC123"),
    );
    expect(mocks.updateRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 108,
        ai_summary_status: "error",
        ai_summary: "总结内容",
        ai_summary_error: expect.stringContaining("Notion"),
      }),
    );
  });
});
