import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPathExists,
  mockStat,
  mockSetFile,
  mockGetRecordById,
  mockQueryRecord,
  mockAddLiveSummaryTask,
} = vi.hoisted(() => ({
  mockPathExists: vi.fn(),
  mockStat: vi.fn(),
  mockSetFile: vi.fn((filePath: string) =>
    filePath.endsWith(".transcript.txt") ? "transcript-file-id" : "video-file-id",
  ),
  mockGetRecordById: vi.fn(),
  mockQueryRecord: vi.fn(),
  mockAddLiveSummaryTask: vi.fn(),
}));

vi.mock("@koa/router", () => {
  return {
    default: class Router {
      stack: any[] = [];
      prefix: string = "";
      constructor(options?: { prefix?: string }) {
        this.prefix = options?.prefix || "";
      }
      get(path: string, ...stack: any[]) {
        this.stack.push({ path: `${this.prefix}${path}`, methods: ["GET"], stack });
      }
      post(path: string, ...stack: any[]) {
        this.stack.push({ path: `${this.prefix}${path}`, methods: ["POST"], stack });
      }
      delete(path: string, ...stack: any[]) {
        this.stack.push({ path: `${this.prefix}${path}`, methods: ["DELETE"], stack });
      }
    },
  };
});

vi.mock("fs-extra", () => ({
  default: {
    pathExists: mockPathExists,
    stat: mockStat,
  },
}));

vi.mock("@biliLive-tools/shared/utils/index.js", () => ({
  replaceExtName: (filePath: string, ext: string) => filePath.replace(/\.[^.]+$/, ext),
}));

vi.mock("@biliLive-tools/shared/recorder/recordHistory.js", () => ({
  default: {
    getRecordById: mockGetRecordById,
  },
}));

vi.mock("@biliLive-tools/shared/db/index.js", () => ({
  recordHistoryService: {
    query: mockQueryRecord,
  },
}));

vi.mock("@biliLive-tools/shared/task/liveSummary.js", () => ({
  addLiveSummaryTask: mockAddLiveSummaryTask,
  exportExistingLiveSummary: vi.fn(),
}));

vi.mock("../src/index.js", () => ({
  fileCache: {
    setFile: mockSetFile,
  },
}));

import router from "../src/routes/recordHistory.js";

const getHandler = (routePath: string, method: "GET" | "POST" | "DELETE") => {
  const route = router.stack.find(
    (item) => item.path === routePath && item.methods.includes(method),
  );
  return route?.stack[0];
};

describe("record history routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddLiveSummaryTask.mockReturnValue({ taskId: "task-1" });
  });

  it("文件信息包含已保存 ASR 转写文本的下载文件 id", async () => {
    const videoFile = "/records/live.flv";
    const transcriptFile = "/records/live.transcript.txt";
    mockGetRecordById.mockReturnValue({
      id: 1,
      video_file: videoFile,
      ai_transcript_file: transcriptFile,
    });
    mockPathExists.mockImplementation(async (filePath: string) => {
      return filePath === videoFile || filePath === transcriptFile;
    });
    mockStat.mockResolvedValue({ size: 1024, mtimeMs: 1234 });

    const ctx: any = {
      params: { id: "1" },
      body: null,
      status: 200,
    };

    await getHandler("/record-history/file/:id", "GET")(ctx, async () => {});

    expect(mockSetFile).toHaveBeenCalledWith(transcriptFile);
    expect(ctx.body).toEqual(
      expect.objectContaining({
        videoFileId: "video-file-id",
        transcriptFilePath: transcriptFile,
        transcriptFileId: "transcript-file-id",
      }),
    );
  });

  it("普通直播总结入口保持单条录制总结", async () => {
    const videoFile = "/records/live.flv";
    mockQueryRecord.mockReturnValue({
      id: 1,
      title: "直播标题",
      record_start_time: 1781105107602,
      ai_summary_status: "completed",
      streamer: {
        name: "主播",
        room_id: "123",
        platform: "Bilibili",
      },
    });
    mockGetRecordById.mockReturnValue({ id: 1, video_file: videoFile });
    mockPathExists.mockResolvedValue(true);

    const ctx: any = {
      params: { id: "1" },
      body: null,
      status: 200,
    };

    await getHandler("/record-history/:id/live-summary", "POST")(ctx, async () => {});

    expect(mockAddLiveSummaryTask).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: 1,
        videoFile,
        summaryMode: "record",
      }),
      { force: true },
    );
    expect(ctx.body.message).toBe("已添加直播总结任务");
  });

  it("整场直播总结入口会请求按场次整合", async () => {
    const videoFile = "/records/live.flv";
    mockQueryRecord.mockReturnValue({
      id: 1,
      title: "直播标题",
      record_start_time: 1781105107602,
      ai_summary_status: "completed",
      streamer: {
        name: "主播",
        room_id: "123",
        platform: "Bilibili",
      },
    });
    mockGetRecordById.mockReturnValue({ id: 1, video_file: videoFile });
    mockPathExists.mockResolvedValue(true);

    const ctx: any = {
      params: { id: "1" },
      body: null,
      status: 200,
    };

    await getHandler("/record-history/:id/live-summary/session", "POST")(ctx, async () => {});

    expect(mockAddLiveSummaryTask).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: 1,
        videoFile,
        summaryMode: "session",
      }),
      { force: true },
    );
    expect(ctx.body.message).toBe("已添加整场直播总结任务");
  });
});
