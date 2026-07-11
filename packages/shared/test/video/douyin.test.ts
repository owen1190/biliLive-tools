import { describe, expect, it, vi, beforeEach } from "vitest";

const { getMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    create: () => ({
      get: getMock,
    }),
  },
}));

const { parseShortVideo } = await import("../../src/video/douyin.js");

function buildDouyinPage(data: unknown) {
  return `<html><body><script id="RENDER_DATA" type="application/json">${encodeURIComponent(
    JSON.stringify(data),
  )}</script></body></html>`;
}

describe("douyin short video parser", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("parses a redirected short video link from render data", async () => {
    getMock.mockResolvedValue({
      data: buildDouyinPage({
        app: {
          aweme: {
            aweme_id: "7553114817708594226",
            desc: "视频描述",
            author: {
              nickname: "测试作者",
            },
            video: {
              play_addr: {
                url_list: ["https://example.com/video.mp4"],
              },
              cover: {
                url_list: ["https://example.com/cover.jpg"],
              },
            },
          },
        },
      }),
      request: {
        res: {
          responseUrl: "https://www.douyin.com/video/7553114817708594226",
        },
      },
    });

    const result = await parseShortVideo("https://v.douyin.com/test/");

    expect(result).toMatchObject({
      awemeId: "7553114817708594226",
      title: "视频描述",
      desc: "视频描述",
      author: "测试作者",
      cover: "https://example.com/cover.jpg",
      playUrl: "https://example.com/video.mp4",
      sourceUrl: "https://www.douyin.com/video/7553114817708594226",
    });
  });

  it("reports a clear error when the play url is missing", async () => {
    getMock.mockResolvedValue({
      data: buildDouyinPage({
        app: {
          aweme: {
            aweme_id: "7553114817708594226",
            desc: "视频描述",
          },
        },
      }),
      request: {
        res: {
          responseUrl: "https://www.douyin.com/video/7553114817708594226",
        },
      },
    });

    await expect(parseShortVideo("https://v.douyin.com/test/")).rejects.toThrow(
      "无法解析抖音视频播放地址",
    );
  });
});
