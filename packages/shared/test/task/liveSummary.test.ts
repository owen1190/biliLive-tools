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
    sendMessage: vi.fn(),
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
    readFile: vi.fn(),
    writeFile: vi.fn(),
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
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
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
          saveTranscript: true,
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
    sendMessage: mocks.sendMessage,
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

vi.mock("../../src/video/douyin.js", () => ({
  default: {
    parseShortVideo: vi
      .fn()
      .mockResolvedValue({
        awemeId: "video-1",
        title: "视频标题",
        sourceUrl: "https://v.douyin.com/test",
        playUrl: "https://example.com/video.mp4",
      }),
    downloadFile: vi.fn().mockResolvedValue(undefined),
  },
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
import { OpenAICompatibleLLM } from "../../src/ai/index.js";
import { DouyinVideoAnalysisTask } from "../../src/task/douyinVideoAnalysis.js";

describe("LiveSummaryTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathExists.mockResolvedValue(true);
    mocks.readFile.mockResolvedValue("已保存的 ASR 转写内容");
    mocks.ensureDir.mockResolvedValue(undefined);
    mocks.remove.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.sendMessage.mockResolvedValue({
      content: "总结内容",
      usage: {},
    });
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

  it("passes per-model request settings without imposing a task-specific output cap", async () => {
    const modelConfig = { maxTokens: 14000, enableThinking: false };
    mocks.getModel.mockReturnValue({
      vendorId: "vendor-1",
      modelName: "qwen",
      config: { llm: modelConfig },
    });
    mocks.sendMessage.mockRejectedValue(new Error("stop after request"));
    const task = new LiveSummaryTask({
      recordId: 108,
      transcriptFile: "/records/live.transcript.txt",
    });
    await expect((task as any).run()).rejects.toThrow("stop after request");
    expect(OpenAICompatibleLLM).toHaveBeenCalledWith(expect.objectContaining({ modelConfig }));
    expect(mocks.sendMessage.mock.calls[0][2]).not.toHaveProperty("maxTokens");
  });

  it("uses the same per-model settings for Douyin analysis without the old 2500-token cap", async () => {
    const modelConfig = { maxTokens: 14000, enableThinking: false };
    mocks.getModel.mockReturnValue({
      vendorId: "vendor-1",
      modelName: "qwen",
      config: { llm: modelConfig },
    });
    const task = new DouyinVideoAnalysisTask({ url: "https://v.douyin.com/test" });
    await (task as any).run();
    expect(OpenAICompatibleLLM).toHaveBeenCalledWith(expect.objectContaining({ modelConfig }));
    expect(mocks.sendMessage.mock.calls[0][2]).not.toHaveProperty("maxTokens");
    expect((task.output as any).summary).toBe("总结内容");
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

  it("reuses a saved transcript when the video has already been synchronized", async () => {
    const transcriptFile = "/records/live.transcript.txt";
    mocks.queryRecord.mockReturnValue({
      id: 108,
      streamer_id: 1,
      live_id: undefined,
      record_start_time: 1781105107602,
      title: "直播标题",
      video_file: undefined,
      ai_transcript_file: transcriptFile,
    });
    mocks.pathExists.mockImplementation(async (filePath: string) => filePath === transcriptFile);
    mocks.readFile.mockResolvedValue("[00:00:00-00:00:03] 已保存的 ASR 转写内容");
    mocks.getEnabledSummaryExportTargetNames.mockReturnValue([]);

    const task = new LiveSummaryTask({
      recordId: 108,
      transcriptFile,
      summaryMode: "session",
      title: "直播标题",
      streamer: "主播",
      roomId: "123",
      platform: "Bilibili",
      recordStartTime: 1781105107602,
    });

    await expect((task as any).run()).resolves.toBeUndefined();

    expect(mocks.createASRProvider).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.readFile).toHaveBeenCalledWith(transcriptFile, "utf8");
    expect(mocks.updateRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 108,
        ai_summary_status: "completed",
      }),
    );
  });

  it("prefers a saved transcript over the video when both are available", async () => {
    const transcriptFile = "/records/live.transcript.txt";
    mocks.queryRecord.mockReturnValue({
      id: 108,
      streamer_id: 1,
      live_id: undefined,
      record_start_time: 1781105107602,
      title: "直播标题",
      video_file: "/records/live.flv",
      ai_transcript_file: transcriptFile,
    });
    mocks.pathExists.mockResolvedValue(true);
    mocks.getEnabledSummaryExportTargetNames.mockReturnValue([]);

    const task = new LiveSummaryTask({
      recordId: 108,
      videoFile: "/records/live.flv",
      transcriptFile,
      title: "直播标题",
      streamer: "主播",
      roomId: "123",
      platform: "Bilibili",
      recordStartTime: 1781105107602,
    });

    await expect((task as any).run()).resolves.toBeUndefined();

    expect(mocks.createASRProvider).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.readFile).toHaveBeenCalledWith(transcriptFile, "utf8");
  });

  it("reuses an existing whole-session transcript even when the session still has videos", async () => {
    const transcriptFile = "/records/live.session.transcript.txt";
    const targetRecord = {
      id: 108,
      streamer_id: 1,
      live_id: "live-1",
      record_start_time: 1781105107602,
      title: "直播标题",
      video_file: "/records/live.flv",
    };
    mocks.queryRecord.mockReturnValue(targetRecord);
    mocks.listSameLiveRecords.mockReturnValue([targetRecord]);
    mocks.pathExists.mockResolvedValue(true);
    mocks.getEnabledSummaryExportTargetNames.mockReturnValue([]);

    const task = new LiveSummaryTask({
      recordId: 108,
      videoFile: "/records/live.flv",
      transcriptFile,
      summaryMode: "session",
      title: "直播标题",
      streamer: "主播",
      roomId: "123",
      platform: "Bilibili",
      recordStartTime: 1781105107602,
    });

    await expect((task as any).run()).resolves.toBeUndefined();

    expect(mocks.createASRProvider).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.readFile).toHaveBeenCalledWith(transcriptFile, "utf8");
  });

  it("persists the ASR checkpoint before calling the LLM", async () => {
    mocks.getEnabledSummaryExportTargetNames.mockReturnValue([]);
    mocks.sendMessage.mockRejectedValue(new Error("LLM 服务不可用"));

    const task = new LiveSummaryTask({
      recordId: 108,
      videoFile: "/records/live.flv",
      title: "直播标题",
      streamer: "主播",
      roomId: "123",
      platform: "Bilibili",
      recordStartTime: 1781105107602,
    });

    await expect((task as any).run()).rejects.toThrow("LLM 服务不可用");

    const transcriptFile = "/records/live.transcript.txt";
    expect(mocks.writeFile).toHaveBeenCalledWith(
      transcriptFile,
      expect.stringContaining("转写内容"),
    );
    expect(mocks.updateRecord).toHaveBeenCalledWith({
      id: 108,
      ai_transcript_file: transcriptFile,
    });
    const checkpointCallIndex = mocks.updateRecord.mock.calls.findIndex(
      ([options]) => options.ai_transcript_file === transcriptFile,
    );
    expect(mocks.updateRecord.mock.invocationCallOrder[checkpointCallIndex]).toBeLessThan(
      mocks.sendMessage.mock.invocationCallOrder[0],
    );
  });
});
