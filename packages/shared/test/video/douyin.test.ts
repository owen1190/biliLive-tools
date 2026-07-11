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

function buildMobileSharePage(data: unknown) {
  return `<html><body><script>window._ROUTER_DATA = ${JSON.stringify(data)}</script></body></html>`;
}

describe("douyin short video parser", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("parses a redirected short video link from render data", async () => {
    getMock.mockResolvedValue({
      status: 200,
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

  it("parses a polluted short link from the mobile share page router data", async () => {
    getMock
      .mockResolvedValueOnce({
        status: 302,
        headers: {
          location: "https://www.iesdouyin.com/share/video/7660960601258248549/?region=CN",
        },
        data: "",
      })
      .mockResolvedValueOnce({
        status: 200,
        data: buildMobileSharePage({
          loaderData: {
            "video_(id)/page": {
              videoInfoRes: {
                item_list: [
                  {
                    aweme_id: "7660960601258248549",
                    desc: "涨价，开始反噬？#存储#科创板",
                    author: {
                      nickname: "机构一手调研（福总）",
                    },
                    video: {
                      play_addr: {
                        url_list: ["https://aweme.snssdk.com/aweme/v1/playwm/?video_id=test"],
                      },
                      cover: {
                        url_list: ["https://example.com/mobile-cover.jpg"],
                      },
                    },
                  },
                ],
              },
            },
          },
        }),
      });

    const result = await parseShortVideo("https://v.douyin.com/Pv34n-tIyJI/%2002/15");

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      "https://v.douyin.com/Pv34n-tIyJI/",
      expect.objectContaining({
        maxRedirects: 0,
      }),
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      "https://www.iesdouyin.com/share/video/7660960601258248549/?region=CN",
      expect.objectContaining({
        headers: expect.objectContaining({
          Referer: "https://www.iesdouyin.com/",
        }),
      }),
    );
    expect(result).toMatchObject({
      awemeId: "7660960601258248549",
      title: "涨价，开始反噬？#存储#科创板",
      author: "机构一手调研（福总）",
      cover: "https://example.com/mobile-cover.jpg",
      playUrl: "https://aweme.snssdk.com/aweme/v1/playwm/?video_id=test",
      sourceUrl: "https://www.douyin.com/video/7660960601258248549",
    });
  });

  it("parses a canonical douyin video link through the mobile share fallback", async () => {
    getMock
      .mockResolvedValueOnce({
        status: 200,
        data: "<html><body>challenge page</body></html>",
        request: {
          res: {
            responseUrl: "https://www.douyin.com/video/7660960601258248549",
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: buildMobileSharePage({
          loaderData: {
            "video_(id)/page": {
              videoInfoRes: {
                item_list: [
                  {
                    aweme_id: "7660960601258248549",
                    desc: "直链视频",
                    video: {
                      play_addr: {
                        url_list: ["https://aweme.snssdk.com/aweme/v1/playwm/?video_id=direct"],
                      },
                    },
                  },
                ],
              },
            },
          },
        }),
      });

    const result = await parseShortVideo("https://www.douyin.com/video/7660960601258248549");

    expect(getMock).toHaveBeenNthCalledWith(
      2,
      "https://www.iesdouyin.com/share/video/7660960601258248549/",
      expect.objectContaining({
        headers: expect.objectContaining({
          Referer: "https://www.iesdouyin.com/",
        }),
      }),
    );
    expect(result).toMatchObject({
      awemeId: "7660960601258248549",
      title: "直链视频",
      playUrl: "https://aweme.snssdk.com/aweme/v1/playwm/?video_id=direct",
      sourceUrl: "https://www.douyin.com/video/7660960601258248549",
    });
  });

  it("reports a clear error when the play url is missing", async () => {
    getMock.mockResolvedValue({
      status: 200,
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
