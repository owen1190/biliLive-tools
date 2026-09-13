// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  clipSrtToTimeRange,
  convertAsrTranscriptToSrt,
  parseAsrTranscript,
} from "./transcriptToSrt";

describe("ASR transcript to SRT", () => {
  it("converts timestamped transcript lines", () => {
    const result = convertAsrTranscriptToSrt(
      "[00:00:01-00:00:03] 第一行\n[00:00:04-00:00:06] 第二行",
    );

    expect(result).toBe(
      "1\n00:00:01,000 --> 00:00:03,000\n第一行\n\n2\n00:00:04,000 --> 00:00:06,000\n第二行",
    );
  });

  it("keeps millisecond precision when present", () => {
    expect(parseAsrTranscript("[00:01:02.125-00:01:04,5] 内容")).toEqual([
      { start: 62.125, end: 64.5, text: "内容" },
    ]);
  });

  it("accepts a single-record transcript with a 1/1 header", () => {
    expect(
      convertAsrTranscriptToSrt(
        "===== 片段 1/1: live.flv =====\n录制开始时间：2026/8/14 10:00:00\n[00:00:01-00:00:03] 内容",
      ),
    ).toContain("00:00:01,000 --> 00:00:03,000");
  });

  it("rejects transcript without timestamps", () => {
    expect(() => convertAsrTranscriptToSrt("只有纯文本，没有时间轴")).toThrow("不包含字幕时间戳");
  });

  it("rejects whole-session transcript", () => {
    expect(() =>
      convertAsrTranscriptToSrt("===== 片段 1/2: first.mp4 =====\n[00:00:00-00:00:03] 第一段"),
    ).toThrow("暂不支持整场转写文件");
  });

  it("repairs a zero-duration cue using a one-second fallback", () => {
    expect(convertAsrTranscriptToSrt("[00:00:32-00:00:32] 内容")).toContain(
      "00:00:32,000 --> 00:00:33,000",
    );
  });

  it("repairs a zero-duration cue using the next cue start", () => {
    expect(parseAsrTranscript("[00:00:32-00:00:32] 第一行\n[00:00:35-00:00:37] 第二行")).toEqual([
      { start: 32, end: 35, text: "第一行" },
      { start: 35, end: 37, text: "第二行" },
    ]);
  });

  it("rejects reversed time ranges", () => {
    expect(() => convertAsrTranscriptToSrt("[00:00:05-00:00:03] 内容")).toThrow("转写时间范围无效");
  });

  it("rejects malformed timestamp lines instead of silently dropping them", () => {
    expect(() => convertAsrTranscriptToSrt("[00:00:01-错误时间] 内容")).toThrow(
      "无法解析转写时间行",
    );
  });

  it("rejects a timeline that resets to zero", () => {
    expect(() =>
      convertAsrTranscriptToSrt("[00:01:00-00:01:03] 第一段\n[00:00:00-00:00:03] 第二段"),
    ).toThrow("时间轴不是递增顺序");
  });

  it("loads only subtitles inside the selected cut and clips boundary cues", () => {
    const source = convertAsrTranscriptToSrt(
      "[00:00:28-00:00:33] 跨越起点\n[00:00:35-00:00:37] 切片内\n[00:00:39-00:00:45] 跨越终点",
    );

    expect(clipSrtToTimeRange(source, 32, 40).replace(/\r\n/g, "\n").trimEnd()).toBe(
      "1\n00:00:32,000 --> 00:00:33,000\n跨越起点\n\n" +
        "2\n00:00:35,000 --> 00:00:37,000\n切片内\n\n" +
        "3\n00:00:39,000 --> 00:00:40,000\n跨越终点",
    );
  });

  it("rejects a selected cut without matching subtitles", () => {
    const source = convertAsrTranscriptToSrt("[00:00:01-00:00:03] 内容");
    expect(() => clipSrtToTimeRange(source, 10, 20)).toThrow("所选切片时间范围内没有字幕");
  });
});
