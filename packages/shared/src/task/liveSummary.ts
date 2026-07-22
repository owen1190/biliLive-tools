import path from "node:path";
import { spawn } from "node:child_process";

import fs from "fs-extra";

import { createASRProvider, OpenAICompatibleLLM, type StandardASRResult } from "../ai/index.js";
import { resolveLiveSummaryPrompt } from "../ai/liveSummaryConfig.js";
import {
  buildLiveSummaryNotification,
  exportSummaryToTargets,
  getEnabledSummaryExportTargetNames,
  SummaryExportError,
  type SummaryExportResult,
} from "../ai/summaryExport.js";
import { appConfig } from "../config.js";
import { recordHistoryService } from "../db/index.js";
import { TaskType } from "../enum.js";
import { getModel } from "../musicDetector/utils.js";
import { sendNotify } from "../notify.js";
import { getTempPath, replaceExtName } from "../utils/index.js";
import logger from "../utils/log.js";
import { AbstractTask, taskQueue } from "./core/index.js";
import { exportExistingLiveSummaryWithDeps } from "./liveSummaryExport.js";
import {
  buildSessionTranscript,
  formatLiveSummaryTitle,
  isSessionTranscriptFile,
  resolveLiveSummarySessionClips,
  type LiveSummarySessionClip,
  type LiveSummarySessionTranscriptPart,
} from "./liveSummarySession.js";

export interface LiveSummaryTaskOptions {
  recordId: number;
  videoFile?: string;
  transcriptFile?: string;
  summaryMode?: "record" | "session";
  customPrompt?: string;
  title?: string;
  streamer?: string;
  roomId?: string;
  platform?: string;
  recordStartTime?: number;
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

function formatSummaryModeContent(summary: string, summaryMode: "record" | "session") {
  if (summaryMode !== "session") return summary;
  return summary.startsWith("【整场总结】") ? summary : `【整场总结】\n\n${summary}`;
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new Error("直播总结任务已取消");
  }
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
      reject(new Error("直播总结任务已取消"));
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

async function resolveExistingVideoFile(videoFile: string) {
  if (await fs.pathExists(videoFile)) {
    return videoFile;
  }
  const mp4File = replaceExtName(videoFile, ".mp4");
  if (await fs.pathExists(mp4File)) {
    return mp4File;
  }
  return null;
}

async function resolveExistingTranscriptFile(transcriptFile?: string) {
  if (!transcriptFile || !(await fs.pathExists(transcriptFile))) return null;
  return transcriptFile;
}

function getTranscriptOutputBase(filePath: string) {
  return path.basename(filePath)
    .replace(/\.session\.transcript\.txt$/i, "")
    .replace(/\.transcript\.txt$/i, "")
    .replace(/\.[^.]+$/, "");
}

async function createSummary(input: {
  transcript: string;
  title?: string;
  streamer?: string;
  roomId?: string;
  platform?: string;
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
    input.title ? `直播标题：${input.title}` : "",
    input.streamer ? `主播：${input.streamer}` : "",
    input.platform ? `平台：${input.platform}` : "",
    input.roomId ? `房间号：${input.roomId}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const customPrompt = input.customPrompt?.trim();
  const summaryPrompt = resolveLiveSummaryPrompt(summaryConfig, input, customPrompt);

  logger.info("开始生成直播总结", {
    provider: vendor.provider,
    vendorName: vendor.name,
    model: model.modelName,
    title: input.title,
    streamer: input.streamer,
    roomId: input.roomId,
    platform: input.platform,
    transcriptLength: input.transcript.length,
    truncatedTranscriptLength: transcript.length,
    oneTimePromptUsed: !!customPrompt,
    promptOverrideMatched: !customPrompt && summaryPrompt !== summaryConfig.prompt,
  });
  const response = await llm.sendMessage(
    `${meta}

以下是按时间排列的直播语音转写内容：

${transcript}`,
    summaryPrompt,
    {
      temperature: 0.2,
      maxTokens: 3000,
    },
  );

  if (!response.content) {
    throw new Error("LLM 未返回总结内容");
  }
  logger.info("直播总结生成完成", {
    model: model.modelName,
    summaryLength: response.content.length,
    usage: response.usage,
  });
  return response.content;
}

export class LiveSummaryTask extends AbstractTask {
  type = TaskType.liveSummary;
  controller = new AbortController();
  private options: LiveSummaryTaskOptions;

  constructor(options: LiveSummaryTaskOptions) {
    super();
    this.options = options;
    const sourceFile = options.videoFile || options.transcriptFile || `record-${options.recordId}`;
    this.name = `${options.summaryMode === "session" ? "整场直播总结" : "直播总结"}: ${path.basename(sourceFile)}`;
    this.action = ["kill"];
    this.extra = {
      recordId: options.recordId,
      videoFile: options.videoFile,
      summaryMode: options.summaryMode || "record",
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
        logger.error("直播总结任务失败", error, {
          taskId: this.taskId,
          recordId: this.options.recordId,
          status: this.status,
        });
        if (this.status === "canceled") {
          recordHistoryService.update({
            id: this.options.recordId,
            ai_summary_status: "error",
            ai_summary_error: "直播总结任务已取消",
            ai_summary_time: Date.now(),
          });
          this.emitter.emit("task-cancel", { taskId: this.taskId, autoStart: true });
          return;
        }
        recordHistoryService.update({
          id: this.options.recordId,
          ai_summary_status: "error",
          ai_summary_error: errorMessage,
          ai_summary_time: Date.now(),
        });
        this.emitter.emit("task-error", { taskId: this.taskId, error: errorMessage });
      })
      .finally(() => {
        this.endTime = Date.now();
      });
  }

  private async run() {
    const config = appConfig.getAll();
    const summaryConfig = config.ai.liveSummary;
    const asrModelId = summaryConfig.asrModelId;

    recordHistoryService.update({
      id: this.options.recordId,
      ai_summary_status: "running",
      ai_summary_error: "",
    });
    const targetRecord = recordHistoryService.query({
      id: this.options.recordId,
    });
    if (!targetRecord) {
      throw new Error("记录不存在");
    }

    const targetClip: LiveSummarySessionClip = {
      id: targetRecord.id,
      streamer_id: targetRecord.streamer_id,
      live_id: targetRecord.live_id,
      record_start_time: targetRecord.record_start_time,
      title: targetRecord.title,
      video_file: this.options.videoFile || targetRecord.video_file,
      ai_transcript_file: this.options.transcriptFile || targetRecord.ai_transcript_file,
    };
    const shouldSummarizeSession = this.options.summaryMode === "session";
    const sessionCandidates = targetRecord.live_id
      ? recordHistoryService.listSameLiveRecords(targetRecord)
      : [];
    const sameLiveClips = targetRecord.live_id
      ? resolveLiveSummarySessionClips(targetClip, sessionCandidates)
      : [targetClip];
    const sessionClips = shouldSummarizeSession ? sameLiveClips : [targetClip];
    if (!sessionClips.length) {
      throw new Error("视频文件或 ASR 转写文本不存在");
    }
    const targetClipIndex = sameLiveClips.findIndex((clip) => clip.id === targetRecord.id);

    logger.info("开始执行直播总结任务", {
      taskId: this.taskId,
      recordId: this.options.recordId,
      videoFile: this.options.videoFile,
      title: this.options.title,
      streamer: this.options.streamer,
      liveId: targetRecord.live_id,
      sessionClipCount: sessionClips.length,
      summaryMode: this.options.summaryMode || "record",
    });

    this.custsomProgressMsg = "正在准备场次视频或 ASR 转写";
    this.progress = 10;
    this.emitter.emit("task-progress", { taskId: this.taskId });

    const workDir = path.join(getTempPath(), "live-summary", this.taskId);
    try {
      const transcriptParts: LiveSummarySessionTranscriptPart[] = [];
      let transcript = "";
      const sourceClips = await Promise.all(
        sessionClips.map(async (clip) => ({
          clip,
          videoFile: clip.video_file ? await resolveExistingVideoFile(clip.video_file) : null,
          transcriptFile: await resolveExistingTranscriptFile(clip.ai_transcript_file),
        })),
      );
      const hasExistingVideo = sourceClips.some((item) => item.videoFile);
      const existingSessionTranscript =
        shouldSummarizeSession && !hasExistingVideo
          ? sourceClips.find((item) => isSessionTranscriptFile(item.transcriptFile ?? undefined))
              ?.transcriptFile
          : null;

      if (existingSessionTranscript) {
        transcript = await fs.readFile(existingSessionTranscript, "utf8");
        logger.info("复用已保存的整场 ASR 转写文本", {
          taskId: this.taskId,
          recordId: this.options.recordId,
          transcriptFile: existingSessionTranscript,
          transcriptLength: transcript.length,
        });
      } else {
        let asr: ReturnType<typeof createASRProvider> | undefined;
        for (let index = 0; index < sessionClips.length; index++) {
          const { clip, videoFile, transcriptFile: savedTranscriptFile } = sourceClips[index];
          // 视频优先；只有视频不存在时，才允许使用片段级 ASR 文本。
          const transcriptFile =
            videoFile || isSessionTranscriptFile(savedTranscriptFile ?? undefined)
              ? null
              : savedTranscriptFile;

          this.custsomProgressMsg = `正在处理语音 ${index + 1}/${sessionClips.length}`;
          this.progress = 15 + Math.floor((index / sessionClips.length) * 50);
          this.emitter.emit("task-progress", { taskId: this.taskId });

          let clipTranscript = "";
          if (transcriptFile) {
            clipTranscript = await fs.readFile(transcriptFile, "utf8");
            logger.info("复用已保存的直播 ASR 转写文本", {
              taskId: this.taskId,
              recordId: clip.id,
              transcriptFile,
              transcriptLength: clipTranscript.length,
            });
          } else {
            if (!videoFile) {
              throw new Error(`场次片段视频或 ASR 转写文本不存在：${clip.id}`);
            }
            if (!asrModelId) {
              throw new Error("请先在 AI 配置中设置直播总结 ASR 模型");
            }
            asr ||= createASRProvider(asrModelId);

            const audioFile = path.join(workDir, `audio-${clip.id}.mp3`);
            logger.info("开始提取直播总结音频", {
              taskId: this.taskId,
              recordId: clip.id,
              videoFile,
              audioFile,
            });
            await extractAudioToMp3(videoFile, audioFile, this.controller.signal);
            logger.info("直播总结音频提取完成", {
              taskId: this.taskId,
              recordId: clip.id,
              audioFile,
            });
            throwIfAborted(this.controller.signal);

            logger.info("开始识别直播总结语音", {
              taskId: this.taskId,
              recordId: clip.id,
              asrModelId,
              audioFile,
            });
            const result = await asr.recognizeLocalFile(audioFile);
            logger.info("直播总结语音识别完成", {
              taskId: this.taskId,
              recordId: clip.id,
              textLength: result.text.length,
              segmentCount: result.segments.length,
            });
            throwIfAborted(this.controller.signal);
            clipTranscript = buildTranscript(result);
          }

          if (clipTranscript.trim()) {
            transcriptParts.push({
              clip: {
                ...clip,
                video_file: videoFile || clip.video_file,
              },
              transcript: clipTranscript,
            });
          }
        }
        transcript = buildSessionTranscript(transcriptParts);
      }
      if (!transcript.trim()) {
        throw new Error("ASR 未识别到有效语音内容");
      }

      let savedTranscriptFile: string | undefined;
      if (summaryConfig.saveTranscript) {
        const transcriptSuffix = shouldSummarizeSession
          ? ".session.transcript.txt"
          : ".transcript.txt";
        const outputSourceFile =
          this.options.videoFile ||
          this.options.transcriptFile ||
          targetRecord.video_file ||
          targetRecord.ai_transcript_file;
        if (!outputSourceFile) {
          throw new Error("无法确定 ASR 转写文本保存路径");
        }
        savedTranscriptFile = path.join(
          path.dirname(outputSourceFile),
          `${getTranscriptOutputBase(outputSourceFile)}${transcriptSuffix}`,
        );
        await fs.writeFile(savedTranscriptFile, transcript);
        logger.info("直播总结转写文本已保存", {
          taskId: this.taskId,
          transcriptFile: savedTranscriptFile,
          transcriptLength: transcript.length,
          sessionClipCount: sessionClips.length,
          summaryMode: this.options.summaryMode || "record",
        });
      }

      this.custsomProgressMsg = "正在生成总结";
      this.progress = 70;
      this.emitter.emit("task-progress", { taskId: this.taskId });

      const summaryMode = this.options.summaryMode || "record";
      const summaryTitle = formatLiveSummaryTitle(this.options.title, {
        mode: summaryMode,
        clipIndex: targetClipIndex >= 0 ? targetClipIndex : undefined,
        clipCount: sameLiveClips.length,
      });
      const rawSummary = await createSummary({
        transcript,
        title: summaryTitle,
        streamer: this.options.streamer,
        roomId: this.options.roomId,
        platform: this.options.platform,
        customPrompt: this.options.customPrompt,
      });
      const summary = formatSummaryModeContent(rawSummary, summaryMode);
      throwIfAborted(this.controller.signal);

      const exportTargets = getEnabledSummaryExportTargetNames(summaryConfig);
      let exportResults: SummaryExportResult[] = [];
      let exportErrorMessage = "";
      if (exportTargets.length) {
        this.custsomProgressMsg = `正在导出总结到${exportTargets.join("、")}`;
        this.progress = 90;
        this.emitter.emit("task-progress", { taskId: this.taskId });

        try {
          exportResults = await exportSummaryToTargets(
            summary,
            {
              ...this.options,
              title: summaryTitle,
            },
            summaryConfig,
          );
          logger.info("直播总结导出完成", {
            taskId: this.taskId,
            targets: exportTargets,
            links: exportResults.map((item) => item.url),
          });
        } catch (error) {
          exportResults = error instanceof SummaryExportError ? error.results : [];
          exportErrorMessage = error instanceof Error ? error.message : String(error);
          logger.warn("直播总结部分导出失败，将继续发送已成功导出的通知", {
            taskId: this.taskId,
            recordId: this.options.recordId,
            error: exportErrorMessage,
            links: exportResults.map((item) => item.url),
          });
        }
      }

      if (exportResults.some((item) => item.url)) {
        const notification = buildLiveSummaryNotification(this.options, exportResults);
        try {
          await sendNotify(notification.title, notification.desp);
          logger.info("直播总结通知发送完成", {
            taskId: this.taskId,
            recordId: this.options.recordId,
            targets: exportResults.map((item) => item.target),
          });
        } catch (error) {
          logger.error("直播总结通知发送失败", error, {
            taskId: this.taskId,
            recordId: this.options.recordId,
          });
        }
      }

      if (exportErrorMessage) {
        recordHistoryService.update({
          id: this.options.recordId,
          ai_summary_status: "error",
          ai_summary: summary,
          ai_summary_error: exportErrorMessage,
          ...(savedTranscriptFile ? { ai_transcript_file: savedTranscriptFile } : {}),
          ai_summary_time: Date.now(),
        });
        throw new Error(exportErrorMessage);
      }

      recordHistoryService.update({
        id: this.options.recordId,
        ai_summary_status: "completed",
        ai_summary: summary,
        ai_summary_error: "",
        ...(savedTranscriptFile ? { ai_transcript_file: savedTranscriptFile } : {}),
        ai_summary_time: Date.now(),
      });
      logger.info("直播总结任务完成", {
        taskId: this.taskId,
        recordId: this.options.recordId,
      });
    } finally {
      await fs.remove(workDir);
    }
  }

  pause() {
    return false;
  }

  resume() {
    return false;
  }

  kill() {
    if (["completed", "error", "canceled"].includes(this.status)) return false;
    this.controller.abort();
    this.status = "canceled";
    return true;
  }
}

export async function exportExistingLiveSummary(recordId: number) {
  return exportExistingLiveSummaryWithDeps(recordId, {
    getRecord: (id) => {
      const record = recordHistoryService.query({
        id,
        include: {
          streamer: true,
        },
      });
      if (!record) return undefined;
      return {
        ...record,
        streamer: record.streamer || undefined,
      };
    },
    getSummaryConfig: () => appConfig.getAll().ai.liveSummary,
    getEnabledTargetNames: getEnabledSummaryExportTargetNames,
    exportSummary: exportSummaryToTargets,
    updateRecord: (data) => recordHistoryService.update(data),
    logSuccess: (data) => logger.info("已重新导出直播总结", data),
  });
}

export function addLiveSummaryTask(
  options: LiveSummaryTaskOptions,
  extraOptions?: {
    force?: boolean;
  },
) {
  const config = appConfig.getAll();
  if (!extraOptions?.force && !config.ai.liveSummary.enabled) return null;

  const task = new LiveSummaryTask(options);
  recordHistoryService.update({
    id: options.recordId,
    ai_summary_status: "pending",
    ai_summary_error: "",
  });
  taskQueue.addTask(task, true);
  logger.info("已添加直播总结任务", {
    taskId: task.taskId,
    recordId: options.recordId,
    videoFile: options.videoFile,
    summaryMode: options.summaryMode || "record",
    oneTimePromptUsed: !!options.customPrompt?.trim(),
  });
  return task;
}
