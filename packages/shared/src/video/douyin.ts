import fs from "fs-extra";
import path from "node:path";
import axios from "axios";
import { DownloaderHelper as RangeDownloader } from "node-downloader-helper";

import { taskQueue, DouyinDownloadVideoTask } from "../task/task.js";

const DOUYIN_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const DOUYIN_MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

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

function normalizeDouyinUrl(input: string) {
  const text = input.trim();
  const match = text.match(/https?:\/\/[^\s]+/);
  const rawUrl = (match?.[0] || text).replace(/[，。！？、]+$/u, "");

  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname === "v.douyin.com") {
      const [shareCode] = parsed.pathname.split("/").filter(Boolean);
      if (shareCode) return `${parsed.origin}/${shareCode}/`;
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function resolveUrl(location: string, baseUrl: string) {
  try {
    return new URL(location, baseUrl).toString();
  } catch {
    return "";
  }
}

function extractShareUrl(url: string) {
  const directMatch = url.match(
    /(https?:\/\/(?:www\.)?iesdouyin\.com\/share\/(?:video|note)\/\d+\/?(?:\?[^"'<>\s]*)?)/,
  );
  if (directMatch?.[1]) return directMatch[1];

  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith("iesdouyin.com") && /\/share\/(?:video|note)\/\d+/.test(parsed.pathname)) {
      return parsed.toString();
    }
  } catch {
    return "";
  }

  return "";
}

function extractAwemeId(url: string, html?: string) {
  const candidates = [
    /\/video\/(\d+)/,
    /\/note\/(\d+)/,
    /\/share\/(?:video|note)\/(\d+)/,
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

function parseRouterData(html: string): any {
  const match = html.match(/window\._ROUTER_DATA\s*=\s*(\{.*?\})\s*;?\s*<\/script>/s);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
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

async function resolveDouyinShareUrl(url: string) {
  let currentUrl = normalizeDouyinUrl(url);
  let shareUrl = extractShareUrl(currentUrl);

  for (let i = 0; i < 4; i += 1) {
    const currentAwemeId = extractAwemeId(shareUrl || currentUrl);
    if (shareUrl && currentAwemeId) {
      return {
        sourceUrl: `https://www.douyin.com/video/${currentAwemeId}`,
        shareUrl,
        awemeId: currentAwemeId,
      };
    }

    const response = await douyinRequest.get(currentUrl, {
      maxRedirects: 0,
      validateStatus: (status: number) => status >= 200 && status < 400,
    });
    const redirectedUrl = getRedirectedUrl(response, currentUrl);
    const html = typeof response.data === "string" ? response.data : "";
    const location = asString(response.headers?.location);
    const nextUrl = location ? resolveUrl(location, currentUrl) : "";

    shareUrl =
      shareUrl ||
      extractShareUrl(currentUrl) ||
      extractShareUrl(redirectedUrl) ||
      extractShareUrl(nextUrl);
    const awemeId =
      extractAwemeId(shareUrl || "") ||
      extractAwemeId(redirectedUrl, html) ||
      extractAwemeId(currentUrl, html) ||
      extractAwemeId(nextUrl);

    if (shareUrl && awemeId) {
      return {
        sourceUrl: `https://www.douyin.com/video/${awemeId}`,
        shareUrl,
        awemeId,
      };
    }

    if (response.status >= 300 && nextUrl) {
      currentUrl = nextUrl;
      continue;
    }

    return {
      sourceUrl: redirectedUrl,
      shareUrl,
      awemeId,
      html,
    };
  }

  return {
    sourceUrl: currentUrl,
    shareUrl,
    awemeId: extractAwemeId(shareUrl || currentUrl),
  };
}

async function parseMobileSharePage(shareUrl: string, awemeId: string, sourceUrl: string) {
  const response = await douyinRequest.get(shareUrl, {
    headers: {
      "User-Agent": DOUYIN_MOBILE_USER_AGENT,
      Referer: "https://www.iesdouyin.com/",
    },
  });
  const html = typeof response.data === "string" ? response.data : "";
  const routerData = parseRouterData(html);
  const awemeNode = findAwemeNode(routerData, awemeId);
  return extractShortVideoInfoFromNode(awemeId, sourceUrl, awemeNode);
}

export async function parseShortVideo(url: string): Promise<DouyinShortVideoInfo> {
  const resolved = await resolveDouyinShareUrl(url);
  const sourceUrl = resolved.sourceUrl;
  const awemeId = resolved.awemeId || extractAwemeId(sourceUrl, resolved.html);
  if (!awemeId) {
    throw new Error("无法从抖音链接解析出视频 ID");
  }

  const shareUrl = resolved.shareUrl || `https://www.iesdouyin.com/share/video/${awemeId}/`;
  const mobileInfo = await parseMobileSharePage(shareUrl, awemeId, sourceUrl).catch(() => null);
  if (mobileInfo) return mobileInfo;

  const html = resolved.html || "";
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
