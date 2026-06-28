import path from "node:path";

import type { LiveHistory } from "../db/model/recordHistory.js";

export type LiveSummarySessionClip = Pick<
  LiveHistory,
  "id" | "streamer_id" | "live_id" | "record_start_time" | "title" | "video_file"
>;

export interface LiveSummarySessionTranscriptPart {
  clip: LiveSummarySessionClip;
  transcript: string;
}

export interface LiveSummaryTitleOptions {
  mode: "record" | "session";
  clipIndex?: number;
  clipCount?: number;
}

function hasVideoFile(clip: LiveSummarySessionClip): clip is LiveSummarySessionClip & {
  video_file: string;
} {
  return Boolean(clip.video_file?.trim());
}

function sortByRecordStartTime(a: LiveSummarySessionClip, b: LiveSummarySessionClip) {
  return (a.record_start_time || 0) - (b.record_start_time || 0);
}

export function resolveLiveSummarySessionClips(
  target: LiveSummarySessionClip,
  sessionCandidates: LiveSummarySessionClip[],
) {
  if (!target.live_id) {
    return hasVideoFile(target) ? [target] : [];
  }

  const clips = sessionCandidates
    .filter((clip) => clip.streamer_id === target.streamer_id)
    .filter((clip) => clip.live_id === target.live_id)
    .filter(hasVideoFile)
    .sort(sortByRecordStartTime);

  return clips.length ? clips : hasVideoFile(target) ? [target] : [];
}

function formatRecordStartTime(time?: number) {
  if (!time) return "";
  return new Date(time).toLocaleString("zh-CN", { hour12: false });
}

export function buildSessionTranscript(parts: LiveSummarySessionTranscriptPart[]) {
  return parts
    .map((part, index) => {
      const fileName = part.clip.video_file ? path.basename(part.clip.video_file) : `record-${part.clip.id}`;
      const startedAt = formatRecordStartTime(part.clip.record_start_time);
      const header = [
        `===== 片段 ${index + 1}/${parts.length}: ${fileName} =====`,
        startedAt ? `录制开始时间：${startedAt}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      return `${header}\n${part.transcript.trim()}`;
    })
    .join("\n\n");
}

export function formatLiveSummaryTitle(
  title: string | undefined,
  options: LiveSummaryTitleOptions,
) {
  if (!title) return title;
  if (options.mode === "session") {
    return title.includes("整场") ? title : `${title}（整场）`;
  }
  if (
    typeof options.clipIndex !== "number" ||
    typeof options.clipCount !== "number" ||
    options.clipCount <= 1
  ) {
    return title;
  }
  const label = `片段 ${options.clipIndex + 1}/${options.clipCount}`;
  return title.includes(label) ? title : `${title}（${label}）`;
}
