import axios, { AxiosInstance } from "axios";

import { chunkArray, parseMarkdownBlocks, type MarkdownBlock } from "./markdown.js";

export interface NotionConfig {
  token: string;
  pageId: string;
}

type NotionRichText = {
  type: "text";
  text: {
    content: string;
  };
};

type NotionBlock = {
  object: "block";
  type: string;
  [key: string]: unknown;
};

type NotionPageResponse = {
  id?: string;
};

const NOTION_BASE_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";
const RICH_TEXT_CHUNK_SIZE = 1900;
const NOTION_RETRY_LIMIT = 2;

function splitText(content: string, size: number) {
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += size) {
    chunks.push(content.slice(i, i + size));
  }
  return chunks;
}

function richText(content: string): NotionRichText[] {
  return splitText(content, RICH_TEXT_CHUNK_SIZE).map((item) => ({
    type: "text",
    text: {
      content: item,
    },
  }));
}

function textBlock(type: string, content: string): NotionBlock {
  return {
    object: "block",
    type,
    [type]: {
      rich_text: richText(content),
    },
  };
}

function markdownBlockToNotionBlock(block: MarkdownBlock): NotionBlock {
  if (block.type === "divider") {
    return {
      object: "block",
      type: "divider",
      divider: {},
    };
  }
  if (block.type === "heading") {
    return textBlock(`heading_${Math.min(block.level, 4)}`, block.text);
  }
  if (block.type === "bullet") {
    return textBlock("bulleted_list_item", block.text);
  }
  if (block.type === "ordered") {
    return textBlock("numbered_list_item", block.text);
  }
  return textBlock("paragraph", block.text);
}

export function markdownToNotionBlocks(markdown: string): NotionBlock[] {
  return parseMarkdownBlocks(markdown).map(markdownBlockToNotionBlock);
}

function normalizeUuid(value: string) {
  const compact = value.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(compact)) return "";
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join("-");
}

export function extractNotionPageId(input: string) {
  const value = input.trim();
  if (!value) return "";

  const uuidMatch = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuidMatch?.[0]) return normalizeUuid(uuidMatch[0]);

  const compactMatches = value.match(/[0-9a-f]{32}/gi);
  if (compactMatches?.length) {
    return normalizeUuid(compactMatches[compactMatches.length - 1]);
  }

  return "";
}

type NotionErrorRecord = Record<string, unknown>;

function asRecord(value: unknown): NotionErrorRecord | undefined {
  return value && typeof value === "object" ? (value as NotionErrorRecord) : undefined;
}

function parseResponseData(data: unknown) {
  if (typeof data !== "string") return data;
  const value = data.trim();
  if (!value) return data;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return data;
  }
}

function getResponse(error: unknown) {
  return asRecord(asRecord(error)?.response);
}

function getStatus(error: unknown) {
  const responseStatus = getResponse(error)?.status;
  const status = responseStatus ?? asRecord(error)?.status;
  return typeof status === "number" ? status : undefined;
}

function getErrorCode(error: unknown) {
  const responseCode = asRecord(parseResponseData(getResponse(error)?.data))?.code;
  const code = responseCode ?? asRecord(error)?.code;
  return typeof code === "string" || typeof code === "number" ? String(code) : "";
}

function getErrorMessage(error: unknown) {
  const response = asRecord(parseResponseData(getResponse(error)?.data));
  const nestedError = asRecord(response?.error);
  const responseMessage = response?.message ?? response?.msg ?? nestedError?.message;
  if (typeof responseMessage === "string" && responseMessage.trim()) return responseMessage.trim();

  const message = asRecord(error)?.message;
  if (typeof message === "string" && message.trim()) return message.trim();

  const name = asRecord(error)?.name;
  return typeof name === "string" && name && name !== "Error" ? name : "";
}

function formatNotionResponseError(data: unknown, status?: number, fallback?: string, code?: string) {
  const parts: string[] = [];
  if (status) parts.push(`HTTP ${status}`);
  const response = asRecord(parseResponseData(data));
  const responseCode = response?.code;
  if (responseCode !== undefined) parts.push(`code ${responseCode}`);
  else if (code) parts.push(`code ${code}`);

  const nestedError = asRecord(response?.error);
  const message = response?.message ?? response?.msg ?? nestedError?.message;
  if (typeof message === "string" && message) {
    parts.push(message);
  } else if (typeof data === "string" && data) {
    parts.push(data);
  }

  const additionalData = asRecord(response?.additional_data);
  const rateLimitReason = additionalData?.rate_limit_reason;
  if (typeof rateLimitReason === "string" && rateLimitReason) {
    parts.push(`限流原因：${rateLimitReason}`);
  }
  if (!parts.length && fallback) parts.push(fallback);
  return parts.join("，") || "未知错误";
}

export function formatNotionError(error: unknown) {
  let isAxiosError = false;
  try {
    isAxiosError = axios.isAxiosError(error);
  } catch {
    // Keep formatting useful even if the error came from another Axios copy in a bundled runtime.
  }

  const response = getResponse(error);
  if (
    isAxiosError ||
    response ||
    asRecord(error)?.isAxiosError === true ||
    getStatus(error) !== undefined
  ) {
    const status = getStatus(error);
    if (status === 401) {
      return "Notion Token 无效或已失效，请检查 Internal Integration Token";
    }
    if (status === 403) {
      return "Notion integration 没有写入权限，请确认已将目标页面分享给该 integration";
    }
    if (status === 404) {
      return "Notion 页面不存在或当前 integration 无访问权限，请检查页面 ID/链接，并确认已将目标页面分享给该 integration";
    }

    return `Notion API 调用失败：${formatNotionResponseError(
      response?.data,
      status,
      getErrorMessage(error),
      getErrorCode(error),
    )}`;
  }

  if (error instanceof Error) {
    return error.message
      ? `Notion API 调用失败：${error.message}`
      : "Notion API 调用失败：未知错误";
  }
  const message = getErrorMessage(error);
  return message
    ? `Notion API 调用失败：${message}`
    : "Notion API 调用失败：未知错误";
}

function getRetryAfterMs(error: unknown, attempt: number) {
  const status = getStatus(error);
  if (status !== 429 && status !== 529) return 0;

  const headers = getResponse(error)?.headers;
  const headerRecord = asRecord(headers);
  const getHeader = headerRecord?.get;
  const retryAfter = typeof getHeader === "function"
    ? getHeader.call(headers, "retry-after")
    : headerRecord?.["retry-after"] ?? headerRecord?.["Retry-After"];
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.max(seconds * 1000, 1000), 30000);
  }
  return Math.min(1000 * 2 ** attempt, 30000);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function buildNotionChildPagePayload(parentPageId: string, title: string) {
  return {
    parent: {
      page_id: parentPageId,
    },
    properties: {
      title: {
        title: [
          {
            type: "text",
            text: {
              content: title,
            },
          },
        ],
      },
    },
  };
}

export class NotionClient {
  private client: AxiosInstance;

  constructor(private config: NotionConfig) {
    this.client = axios.create({
      baseURL: NOTION_BASE_URL,
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
    });
  }

  private async requestWithRetry<T>(request: () => Promise<T>) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await request();
      } catch (error) {
        const retryAfterMs = getRetryAfterMs(error, attempt);
        if (!retryAfterMs || attempt >= NOTION_RETRY_LIMIT) throw error;
        await wait(retryAfterMs);
      }
    }
  }

  private async appendMarkdownToPage(pageId: string, markdown: string) {
    const blocks = markdownToNotionBlocks(markdown);
    if (!blocks.length) return;

    for (const children of chunkArray(blocks, 100)) {
      await this.requestWithRetry(() =>
        this.client.patch(`/blocks/${pageId}/children`, {
          children,
        }),
      );
    }
  }

  async appendMarkdown(markdown: string) {
    try {
      await this.appendMarkdownToPage(this.config.pageId, markdown);
    } catch (error) {
      throw new Error(formatNotionError(error));
    }
  }

  async createChildPage(input: { title: string }) {
    try {
      const response = await this.requestWithRetry(() =>
        this.client.post<NotionPageResponse>(
          "/pages",
          buildNotionChildPagePayload(this.config.pageId, input.title),
        ),
      );
      if (!response.data.id) {
        throw new Error("Notion 创建子页面失败：未返回页面 ID");
      }
      return response.data.id;
    } catch (error) {
      throw new Error(formatNotionError(error));
    }
  }

  async createChildPageAndAppendMarkdown(input: { title: string; markdown: string }) {
    const pageId = await this.createChildPage({ title: input.title });
    try {
      await this.appendMarkdownToPage(pageId, input.markdown);
    } catch (error) {
      throw new Error(formatNotionError(error));
    }
    return pageId;
  }
}
