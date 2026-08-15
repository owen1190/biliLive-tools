export interface TranscriptCue {
  start: number;
  end: number;
  text: string;
}

const TRANSCRIPT_LINE_PATTERN =
  /^\s*\[(\d+):([0-5]\d):([0-5]\d)(?:[.,](\d{1,3}))?\s*-\s*(\d+):([0-5]\d):([0-5]\d)(?:[.,](\d{1,3}))?\]\s*(.+?)\s*$/;

const parseMilliseconds = (value?: string) => {
  if (!value) return 0;
  return Number(value.padEnd(3, "0"));
};

const parseTimestamp = (hours: string, minutes: string, seconds: string, milliseconds?: string) =>
  Number(hours) * 3600 +
  Number(minutes) * 60 +
  Number(seconds) +
  parseMilliseconds(milliseconds) / 1000;

const formatSrtTimestamp = (seconds: number) => {
  const totalMilliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
    wholeSeconds,
  ).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
};

export function parseAsrTranscript(content: string): TranscriptCue[] {
  const transcriptHeaders = [...content.matchAll(/^=====\s*片段\s+(\d+)\/(\d+):/gm)];
  if (transcriptHeaders.length > 1 || transcriptHeaders.some((header) => Number(header[2]) > 1)) {
    throw new Error("暂不支持整场转写文件，请选择单个录制片段的 .transcript.txt 文件");
  }

  const cues: TranscriptCue[] = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    const match = trimmedLine.match(TRANSCRIPT_LINE_PATTERN);
    if (!match) {
      if (trimmedLine.startsWith("[")) {
        throw new Error(`无法解析转写时间行：${trimmedLine}`);
      }
      continue;
    }

    const start = parseTimestamp(match[1], match[2], match[3], match[4]);
    const end = parseTimestamp(match[5], match[6], match[7], match[8]);
    const text = match[9].trim();

    if (end <= start) {
      throw new Error(`转写时间范围无效：${trimmedLine}`);
    }
    if (cues.length > 0 && start < cues[cues.length - 1].start) {
      throw new Error("转写时间轴不是递增顺序，可能包含多个从零开始的录制片段");
    }
    if (text) cues.push({ start, end, text });
  }

  if (cues.length === 0) {
    throw new Error("该 TXT 不包含字幕时间戳，无法转换为 SRT");
  }

  return cues;
}

export function convertAsrTranscriptToSrt(content: string): string {
  return parseAsrTranscript(content)
    .map(
      (cue, index) =>
        `${index + 1}\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}\n${cue.text}`,
    )
    .join("\n\n");
}
