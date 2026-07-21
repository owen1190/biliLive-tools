import axios, { AxiosInstance } from "axios";

export interface YuqueConfig {
  token: string;
  namespace: string;
  slug?: string;
  baseUrl?: string;
}

interface YuqueResponse<T = unknown> {
  data?: T;
  message?: string;
  code?: number | string;
}

interface YuqueDocument {
  id?: number;
  title?: string;
  slug?: string;
  body?: string;
}

const YUQUE_BASE_URL = "https://www.yuque.com/api/v2";
const YUQUE_USER_AGENT = "biliLive-tools";

function normalizeBaseUrl(value?: string) {
  return (value?.trim() || YUQUE_BASE_URL).replace(/\/+$/, "");
}

export function extractYuqueNamespace(input: string) {
  const value = input.trim();
  if (!value) return "";

  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const reposIndex = parts.indexOf("repos");
    if (reposIndex >= 0 && parts.length >= reposIndex + 3) {
      return `${parts[reposIndex + 1]}/${parts[reposIndex + 2]}`;
    }
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : "";
  } catch {
    const parts = value.split("/").filter(Boolean);
    const reposIndex = parts.indexOf("repos");
    if (reposIndex >= 0 && parts.length >= reposIndex + 3) {
      return `${parts[reposIndex + 1]}/${parts[reposIndex + 2]}`;
    }
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : value.replace(/^\/+|\/+$/g, "");
  }
}

export function extractYuqueDocSlug(input: string) {
  const value = input.trim();
  if (!value) return "";

  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const docsIndex = parts.indexOf("docs");
    if (docsIndex >= 0 && parts[docsIndex + 1]) return parts[docsIndex + 1];
    if (parts.length >= 4 && parts[2] === "docs") return parts[3];
    return parts.length >= 3 ? parts[2] : "";
  } catch {
    const parts = value.split("/").filter(Boolean);
    const docsIndex = parts.indexOf("docs");
    if (docsIndex >= 0 && parts[docsIndex + 1]) return parts[docsIndex + 1];
    return parts.at(-1) || value;
  }
}

export function buildYuqueDocumentUrl(namespace: string, slug: string) {
  return namespace && slug ? `https://www.yuque.com/${namespace}/${slug}` : "";
}

function formatYuqueResponseError(data: unknown, status?: number, fallback?: string) {
  const parts: string[] = [];
  if (status) parts.push(`HTTP ${status}`);
  if (data && typeof data === "object") {
    const response = data as { code?: unknown; message?: unknown; msg?: unknown };
    if (response.code !== undefined) parts.push(`code ${response.code}`);
    const message = typeof response.message === "string" && response.message
      ? response.message
      : typeof response.msg === "string" && response.msg
        ? response.msg
        : "";
    if (message) parts.push(message);
  } else if (typeof data === "string" && data) {
    parts.push(data);
  }
  if (!parts.length && fallback) parts.push(fallback);
  return parts.join("，") || "未知错误";
}

export function formatYuqueError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 401) {
      return "语雀 Token 无效或已失效，请检查 API Token 权限";
    }
    if (status === 403) {
      return "语雀 Token 没有写入权限，请确认已授予知识库和文档写入权限";
    }
    if (status === 404) {
      return "语雀知识库或文档不存在，请检查知识库路径 namespace 和文档 slug";
    }
    return `语雀 API 调用失败：${formatYuqueResponseError(
      error.response?.data,
      status,
      error.message,
    )}`;
  }

  if (error instanceof Error) {
    return error.message || "语雀 API 调用失败：未知错误";
  }
  return String(error) || "语雀 API 调用失败：未知错误";
}

export class YuqueClient {
  private client: AxiosInstance;

  constructor(private config: YuqueConfig) {
    this.client = axios.create({
      baseURL: normalizeBaseUrl(config.baseUrl),
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": YUQUE_USER_AGENT,
        "X-Auth-Token": config.token,
      },
    });
  }

  private get namespace() {
    return extractYuqueNamespace(this.config.namespace);
  }

  private async request<T>(method: "get" | "post" | "put", url: string, data?: unknown) {
    try {
      const response = await this.client.request<YuqueResponse<T>>({
        method,
        url,
        ...(method === "get" ? { params: data } : { data }),
      });
      if (response.data?.data === undefined) {
        throw new Error(`语雀 API 调用失败：${formatYuqueResponseError(response.data)}`);
      }
      return response.data.data;
    } catch (error) {
      throw new Error(formatYuqueError(error));
    }
  }

  async getDocument(slug = this.config.slug) {
    const docSlug = extractYuqueDocSlug(slug || "");
    if (!this.namespace || !docSlug) {
      throw new Error("请先配置语雀知识库路径和文档 slug");
    }
    return this.request<YuqueDocument>("get", `/repos/${this.namespace}/docs/${docSlug}`, {
      raw: 1,
    });
  }

  async createDocument(input: { title: string; markdown: string; slug?: string }) {
    if (!this.namespace) {
      throw new Error("请先配置语雀知识库路径 namespace");
    }
    const docSlug = extractYuqueDocSlug(input.slug || "");
    if (!docSlug) {
      throw new Error("请先配置语雀文档 slug");
    }
    const data = await this.request<YuqueDocument>("post", `/repos/${this.namespace}/docs`, {
      title: input.title,
      slug: docSlug,
      format: "markdown",
      body: input.markdown,
    });
    const slug = data?.slug || docSlug;
    if (!slug) {
      throw new Error("语雀创建文档失败：未返回文档 slug");
    }
    return extractYuqueDocSlug(slug);
  }

  async updateDocument(input: { id: number | string; title?: string; markdown: string }) {
    if (!this.namespace || !input.id) {
      throw new Error("请先配置语雀知识库路径并获取文档 ID");
    }
    const data = await this.request<YuqueDocument>("put", `/repos/${this.namespace}/docs/${input.id}`, {
      title: input.title,
      body: input.markdown,
    });
    return data?.slug ? extractYuqueDocSlug(data.slug) : "";
  }

  async appendMarkdown(markdown: string, slug = this.config.slug) {
    const current = await this.getDocument(slug);
    if (!current.id) {
      throw new Error("语雀文档详情未返回文档 ID，无法更新文档");
    }
    const body = current.body?.trimEnd();
    const nextBody = [body, "---", markdown].filter(Boolean).join("\n\n");
    const updatedSlug = await this.updateDocument({
      id: current.id,
      title: current.title,
      markdown: nextBody,
    });
    return updatedSlug || extractYuqueDocSlug(slug || current.slug || "");
  }
}
