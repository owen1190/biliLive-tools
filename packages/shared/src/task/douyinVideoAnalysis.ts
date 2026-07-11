import path from "node:path";
import { spawn } from "node:child_process";

import fs from "fs-extra";

import douyin from "../video/douyin.js";
import { createASRProvider, OpenAICompatibleLLM, type StandardASRResult } from "../ai/index.js";
import {
  exportSummaryToTargets,
  getEnabledSummaryExportTargetNames,
  SummaryExportError,
  type SummaryExportResult,
} from "../ai/summaryExport.js";
import { appConfig } from "../config.js";
import { TaskType } from "../enum.js";
import { getModel } from "../musicDetector/utils.js";
import { getTempPath, uuid } from "../utils/index.js";
import logger from "../utils/log.js";
import { AbstractTask, taskQueue } from "./core/index.js";

import type { AppConfig } from "@biliLive-tools/types";
import type { DouyinShortVideoInfo } from "../video/douyin.js";

export interface DouyinVideoAnalysisTaskOptions {
  url: string;
  customPrompt?: string;
  outputDir?: string;
}

export interface DouyinVideoAnalysisOutput {
  title: string;
  sourceUrl: string;
  summary: string;
  transcript: string;
  markdown: string;
  documentFile: string;
  exportResults: SummaryExportResult[];
  exportError?: string;
  videoInfo: DouyinShortVideoInfo;
}

function getVendor(vendorId: string) {
  const config = appConfig.getAll();
  const vendor = config.ai.vendors.find((item) => item.id === vendorId);
  if (!vendor) {
    throw new Error(`找不到LLM模型关联的供应商：${vendorId}`);
  }
  return vendor;
}

function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((item) => String(item).padStart(2, "0")).join(":");
}

function buildTranscript(result: StandardASRResult) {
  if (!result.segments.length) {
    return result.text;
  }
  return result.segments
    .map((segment) => `[${formatTime(segment.start)}-${formatTime(segment.end)}] ${segment.text}`)
    .join("\n");
}

function truncateText(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  const headLength = Math.floor(maxLength * 0.7);
  const tailLength = maxLength - headLength;
  return `${text.slice(0, headLength)}

...[中间内容因长度限制省略]...

${text.slice(-tailLength)}`;
}

function sanitizeDocumentName(name: string) {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "抖音视频分析"
  );
}

function buildPrompt(customPrompt?: string) {
  const prompt = customPrompt?.trim();
  if (prompt) return prompt;
  return `你是一个专业的短视频内容分析助手。请基于抖音视频的语音转写和视频元信息，生成一份高信息密度中文分析。

请按以下 Markdown 结构输出：

# 视频内容分析

## 一句话概述
用 1 句话说明视频核心内容。

## 内容要点
- 提炼 3-8 条最重要的信息。
- 如果转写不清，请明确标注不确定。

## 关键信息
- 人物/主体：提到的人、账号、品牌、地点或对象。
- 事件/观点：视频表达的动作、结论、建议、争议点或情绪。
- 可复用线索：产品、工具、步骤、数字、时间、资源或待办。

## 信息质量
- 判断转写质量为高 / 中 / 低，并说明原因。
- 说明是否存在语音缺失、噪音、音乐遮盖或上下文不足。

只使用简单 Markdown：标题、段落、无序列表、分割线。不要使用表格、HTML、复杂嵌套或任务列表。`;
}

async function extractAudioToMp3(
  videoFile: string,
  outputFile: string,
  signal: AbortSignal,
): Promise<void> {
  const { ffmpegPath } = appConfig.getAll();
  if (!ffmpegPath) {
    throw new Error("未找到 ffmpeg 路径，请先完成 ffmpeg 配置");
  }

  await fs.ensureDir(path.dirname(outputFile));

  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      [
        "-y",
        "-i",
        videoFile,
        "-vn",
        "-acodec",
        "libmp3lame",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-b:a",
        "32k",
        outputFile,
      ],
      { windowsHide: true },
    );

    let stderr = "";
    const onAbort = () => {
      child.kill("SIGKILL");
      reject(new Error("抖音视频分析任务已取消"));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) return;
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`提取音频失败，ffmpeg 退出码：${code}\n${stderr.slice(-1000)}`));
      }
    });
  });
}

async function createSummary(input: {
  transcript: string;
  info: DouyinShortVideoInfo;
  customPrompt?: string;
}) {
  const config = appConfig.getAll();
  const summaryConfig = config.ai.liveSummary;
  const llmModelId = summaryConfig.llmModelId;
  if (!llmModelId) {
    throw new Error("请先在 AI 配置中设置直播总结 LLM 模型");
  }

  const model = getModel(llmModelId, config);
  const vendor = getVendor(model.vendorId);
  if (vendor.provider === "ffmpeg") {
    throw new Error("FFmpeg 供应商不能用于 LLM 模型");
  }

  const llm = new OpenAICompatibleLLM({
    provider: vendor.provider,
    apiKey: vendor.apiKey,
    baseURL: vendor.baseURL,
    model: model.modelName,
    timeout: 120000,
  });

  const maxInputLength = summaryConfig.maxInputLength || 24000;
  const transcript = truncateText(input.transcript, maxInputLength);
  const meta = [
    `视频标题：${input.info.title}`,
    input.info.author ? `作者：${input.info.author}` : "",
    input.info.desc ? `描述：${input.info.desc}` : "",
    `链接：${input.info.sourceUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  logger.info("开始生成抖音视频 AI 分析", {
    provider: vendor.provider,
    vendorName: vendor.name,
    model: model.modelName,
    title: input.info.title,
    awemeId: input.info.awemeId,
    transcriptLength: input.transcript.length,
    truncatedTranscriptLength: transcript.length,
    oneTimePromptUsed: !!input.customPrompt?.trim(),
  });

  const response = await llm.sendMessage(
    `${meta}

以下是视频语音转写内容：

${transcript}`,
    buildPrompt(input.customPrompt),
    {
      temperature: 0.2,
      maxTokens: 2500,
    },
  );

  if (!response.content) {
    throw new Error("LLM 未返回分析内容");
  }
  return response.content;
}

function buildAnalysisMarkdown(output: Omit<DouyinVideoAnalysisOutput, "markdown" | "documentFile">) {
  const meta = [
    `- 来源链接：${output.sourceUrl}`,
    output.videoInfo.author ? `- 作者：${output.videoInfo.author}` : "",
    output.videoInfo.desc ? `- 描述：${output.videoInfo.desc}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [`# ${output.title}`, meta, output.summary, "## ASR 转写", output.transcript]
    .filter(Boolean)
    .join("\n\n");
}

function buildExportBody(output: DouyinVideoAnalysisOutput) {
  const meta = [
    `## 视频信息`,
    `- 来源链接：${output.sourceUrl}`,
    output.videoInfo.author ? `- 作者：${output.videoInfo.author}` : "",
    output.videoInfo.desc ? `- 描述：${output.videoInfo.desc}` : "",
    "",
    `## AI 分析`,
  ]
    .filter(Boolean)
    .join("\n");
  return `${meta}\n\n${output.summary}`;
}

async function parseDouyinVideoForAnalysis(url: string): Promise<DouyinShortVideoInfo> {
  if (url.includes("www.douyin.com/vsdetail")) {
    const match = url.match(/vsdetail\/([A-Za-z0-9]+)/);
    if (!match?.[1]) {
      throw new Error("请输入正确的抖音回放链接");
    }
    const data = await douyin.parseVideo(match[1]);
    const playUrl = data.resolutions[0]?.url;
    if (!playUrl) {
      throw new Error("无法解析抖音回放播放地址");
    }
    return {
      awemeId: match[1],
      title: data.title,
      playUrl,
      sourceUrl: url,
    };
  }

  return douyin.parseShortVideo(url);
}

export class DouyinVideoAnalysisTask extends AbstractTask {
  type = TaskType.douyinVideoAnalysis;
  controller = new AbortController();
  private options: DouyinVideoAnalysisTaskOptions;

  constructor(options: DouyinVideoAnalysisTaskOptions) {
    super();
    this.options = {
      ...options,
      url: options.url.trim(),
      customPrompt: options.customPrompt?.trim(),
      outputDir: options.outputDir?.trim(),
    };
    this.name = "抖音视频 AI 分析";
    this.action = ["kill"];
    this.extra = {
      url: this.options.url,
    };
  }

  exec() {
    if (this.status !== "pending") return;
    this.status = "running";
    this.progress = 0;
    this.startTime = Date.now();
    this.emitter.emit("task-start", { taskId: this.taskId });

    this.run()
      .then(() => {
        if (this.status === "canceled") return;
        this.status = "completed";
        this.progress = 100;
        this.emitter.emit("task-end", { taskId: this.taskId });
      })
      .catch((error) => {
        this.status = this.status === "canceled" ? "canceled" : "error";
        const errorMessage = error?.message || String(error);
        this.error = errorMessage;
        logger.error("抖音视频 AI 分析任务失败", error, {
          taskId: this.taskId,
          status: this.status,
        });
        if (this.status === "canceled") {
          this.emitter.emit("task-cancel", { taskId: this.taskId, autoStart: true });
          return;
        }
        this.emitter.emit("task-error", { taskId: this.taskId, error: errorMessage });
      })
      .finally(() => {
        this.endTime = Date.now();
      });
  }

  private throwIfAborted() {
    if (this.controller.signal.aborted) {
      throw new Error("抖音视频分析任务已取消");
    }
  }

  private async run() {
    const config = appConfig.getAll();
    const summaryConfig = config.ai.liveSummary;
    const asrModelId = summaryConfig.asrModelId;
    if (!asrModelId) {
      throw new Error("请先在 AI 配置中设置直播总结 ASR 模型");
    }

    const workDir = path.join(getTempPath(), "douyin-video-analysis", this.taskId);
    const videoFile = path.join(workDir, "source.mp4");
    const audioFile = path.join(workDir, "audio.mp3");

    try {
      this.custsomProgressMsg = "正在解析抖音链接";
      this.progress = 10;
      this.emitter.emit("task-progress", { taskId: this.taskId });

      const info = await parseDouyinVideoForAnalysis(this.options.url);
      this.name = `抖音视频 AI 分析: ${info.title}`;
      this.extra = {
        ...this.extra,
        awemeId: info.awemeId,
        title: info.title,
        sourceUrl: info.sourceUrl,
        outputDir: this.options.outputDir,
      };
      this.throwIfAborted();

      this.custsomProgressMsg = "正在下载临时视频";
      this.progress = 25;
      this.emitter.emit("task-progress", { taskId: this.taskId });
      await douyin.downloadFile(videoFile, info.playUrl);
      this.throwIfAborted();

      this.custsomProgressMsg = "正在提取音频";
      this.progress = 40;
      this.emitter.emit("task-progress", { taskId: this.taskId });
      await extractAudioToMp3(videoFile, audioFile, this.controller.signal);
      this.throwIfAborted();

      this.custsomProgressMsg = "正在识别语音";
      this.progress = 55;
      this.emitter.emit("task-progress", { taskId: this.taskId });
      const asr = createASRProvider(asrModelId);
      const result = await asr.recognizeLocalFile(audioFile);
      const transcript = buildTranscript(result);
      if (!transcript.trim()) {
        throw new Error("ASR 未识别到有效语音内容");
      }
      this.throwIfAborted();

      this.custsomProgressMsg = "正在生成 AI 分析";
      this.progress = 75;
      this.emitter.emit("task-progress", { taskId: this.taskId });
      const summary = await createSummary({
        transcript,
        info,
        customPrompt: this.options.customPrompt,
      });
      this.throwIfAborted();

      this.custsomProgressMsg = "正在生成 Markdown 文档";
      this.progress = 90;
      this.emitter.emit("task-progress", { taskId: this.taskId });
      const documentDir =
        this.options.outputDir || path.join(getTempPath(), "douyin-video-analysis-docs");
      await fs.ensureDir(documentDir);
      const documentFile = path.join(
        documentDir,
        `${sanitizeDocumentName(info.title)}-${uuid().slice(0, 8)}.md`,
      );
      const outputWithoutDocument = {
        title: info.title,
        sourceUrl: info.sourceUrl,
        summary,
        transcript,
        exportResults: [],
        videoInfo: info,
      };
      const markdown = buildAnalysisMarkdown(outputWithoutDocument);
      await fs.writeFile(documentFile, markdown);

      this.output = {
        ...outputWithoutDocument,
        markdown,
        documentFile,
      } as any;
    } finally {
      await fs.remove(workDir);
    }
  }

  async exportToDocuments(config: AppConfig["ai"]["liveSummary"]) {
    if (this.status !== "completed" || !this.output) {
      throw new Error("请等待 AI 分析完成后再导出文档");
    }
    const output = this.output as unknown as DouyinVideoAnalysisOutput;
    const targets = getEnabledSummaryExportTargetNames(config);
    if (!targets.length) {
      throw new Error("请先在 AI 配置中启用飞书文档或 Notion 导出");
    }

    try {
      const results = await exportSummaryToTargets(
        buildExportBody(output),
        {
          title: output.title,
          platform: "抖音",
          recordStartTime: Date.now(),
        },
        config,
      );
      output.exportResults = results;
      output.exportError = undefined;
      return results;
    } catch (error) {
      if (error instanceof SummaryExportError) {
        output.exportResults = error.results;
        output.exportError = error.message;
      }
      throw error;
    }
  }

  kill() {
    if (this.status === "completed" || this.status === "error" || this.status === "canceled")
      return;
    this.status = "canceled";
    this.controller.abort();
    this.emit("task-cancel", { taskId: this.taskId, autoStart: true });
    return true;
  }

  pause() {
    return false;
  }

  resume() {
    return false;
  }
}

export function addDouyinVideoAnalysisTask(options: DouyinVideoAnalysisTaskOptions) {
  const task = new DouyinVideoAnalysisTask(options);
  taskQueue.addTask(task, true);
  return task;
}
