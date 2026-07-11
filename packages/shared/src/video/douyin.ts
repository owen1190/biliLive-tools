import fs from "fs-extra";
import path from "node:path";
import axios from "axios";
import { DownloaderHelper as RangeDownloader } from "node-downloader-helper";

import { taskQueue, DouyinDownloadVideoTask } from "../task/task.js";

const DOUYIN_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const douyinRequest = axios.create({
  timeout: 15000,
  maxRedirects: 5,
  proxy: false,
  headers: {
    "User-Agent": DOUYIN_USER_AGENT,
    Referer: "https://www.douyin.com/",
  },
});

export interface DouyinShortVideoInfo {
  awemeId: string;
  title: string;
  desc?: string;
  author?: string;
  cover?: string;
  playUrl: string;
  sourceUrl: string;
}

async function download(
  output: string,
  url: string,
  options: {
    override?: boolean;
  },
) {
  if ((await fs.pathExists(output)) && !options.override) throw new Error(`${output}已存在`);
  console.log(`开始下载视频，url=${url}，output=${output}`);
  const dir = path.parse(output).dir;
  const fileName = path.parse(output).base;
  const downloader = new RangeDownloader(url, dir, {
    fileName: fileName,
    retry: {
      maxRetries: 5,
      delay: 3000,
    },
  });
  const task = new DouyinDownloadVideoTask(downloader, {
    name: `下载任务：${path.parse(output).name}`,
  });
  taskQueue.addTask(task, true);
  return task;
}

async function downloadFile(output: string, url: string) {
  await fs.ensureDir(path.dirname(output));
  const response = await douyinRequest.get(url, {
    responseType: "stream",
    headers: {
      Referer: "https://www.douyin.com/",
    },
  });

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(output);
    response.data.pipe(stream);
    response.data.on("error", reject);
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  return output;
}

function getRedirectedUrl(response: any, fallback: string) {
  return response?.request?.res?.responseUrl || response?.request?.responseURL || fallback;
}

function extractAwemeId(url: string, html?: string) {
  const candidates = [
    /\/video\/(\d+)/,
    /\/note\/(\d+)/,
    /[?&](?:modal_id|aweme_id|item_id)=(\d+)/,
  ];
  for (const pattern of candidates) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }

  if (!html) return "";
  const htmlPatterns = [
    /"aweme_id"\s*:\s*"(\d+)"/,
    /"awemeId"\s*:\s*"(\d+)"/,
    /"itemId"\s*:\s*"(\d+)"/,
    /"modal_id"\s*:\s*"(\d+)"/,
  ];
  for (const pattern of htmlPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function parseRenderData(html: string): any {
  const match = html.match(/<script[^>]+id=["']RENDER_DATA["'][^>]*>(.*?)<\/script>/s);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1]));
  } catch {
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function pickFirstString(...values: unknown[]) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const item = value.find((entry) => asString(entry));
      if (item) return asString(item);
    } else {
      const text = asString(value);
      if (text) return text;
    }
  }
  return "";
}

function findAwemeNode(data: any, awemeId: string): any {
  if (!data || typeof data !== "object") return null;

  const nodeId = asString(data.aweme_id) || asString(data.awemeId) || asString(data.id);
  if (nodeId === awemeId && (data.video || data.desc || data.author)) {
    return data;
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findAwemeNode(item, awemeId);
      if (found) return found;
    }
    return null;
  }

  for (const value of Object.values(data)) {
    const found = findAwemeNode(value, awemeId);
    if (found) return found;
  }
  return null;
}

function extractUrlList(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractUrlList(item));
  }
  if (typeof value === "string") {
    return value.startsWith("http") ? [value] : [];
  }
  if (typeof value !== "object") return [];
  return [
    ...extractUrlList(value.url_list),
    ...extractUrlList(value.urlList),
    ...extractUrlList(value.uri),
    ...extractUrlList(value.url),
  ];
}

function extractShortVideoInfoFromNode(
  awemeId: string,
  sourceUrl: string,
  node: any,
): DouyinShortVideoInfo | null {
  if (!node) return null;
  const video = node.video || {};
  const playUrls = [
    ...extractUrlList(video.play_addr),
    ...extractUrlList(video.playAddr),
    ...extractUrlList(video.download_addr),
    ...extractUrlList(video.downloadAddr),
  ].filter((url) => !url.includes("data:image"));
  const playUrl = playUrls[0];
  if (!playUrl) return null;

  const desc = pickFirstString(node.desc, node.caption);
  const title = pickFirstString(node.title, desc, `抖音视频 ${awemeId}`);
  const author = pickFirstString(
    node.author?.nickname,
    node.authorInfo?.nickname,
    node.author?.unique_id,
    node.authorInfo?.uniqueId,
  );
  const cover = pickFirstString(
    extractUrlList(video.cover),
    extractUrlList(video.origin_cover),
    extractUrlList(video.originCover),
    extractUrlList(video.dynamic_cover),
    extractUrlList(video.dynamicCover),
  );

  return {
    awemeId,
    title,
    desc,
    author,
    cover,
    playUrl,
    sourceUrl,
  };
}

export async function parseShortVideo(url: string): Promise<DouyinShortVideoInfo> {
  const response = await douyinRequest.get(url);
  const sourceUrl = getRedirectedUrl(response, url);
  const html = typeof response.data === "string" ? response.data : "";
  const awemeId = extractAwemeId(sourceUrl, html);
  if (!awemeId) {
    throw new Error("无法从抖音链接解析出视频 ID");
  }

  const renderData = parseRenderData(html);
  const awemeNode = findAwemeNode(renderData, awemeId);
  const info = extractShortVideoInfoFromNode(awemeId, sourceUrl, awemeNode);
  if (info) return info;

  throw new Error("无法解析抖音视频播放地址，可能需要登录或链接已失效");
}

/**
 * 解析视频
 */
const parseVideo = async (
  id: string,
): Promise<{
  title: string;
  resolutions: Array<{
    label: string;
    value: string;
    url: string;
  }>;
}> => {
  const res = await axios.get(`https://www.douyin.com/aweme/v1/web/show/episode/enter/`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
    params: {
      device_platform: "webapp",
      aid: "6383",
      episode_id: id,
    },
  });
  if (res.status !== 200) {
    throw new Error("请求错误");
  }
  const episode = res.data.data.episode;
  const playUrls = episode.video_info.unfold_play_info.play_urls.sort(
    (a: any, b: any) => b.width - a.width,
  );

  return {
    title: episode.title,
    resolutions: playUrls.map((item: any) => ({
      label: item.definition,
      value: item.definition,
      url: item.main,
    })),
  };
};

export default {
  parseVideo,
  parseShortVideo,
  download,
  downloadFile,
};
