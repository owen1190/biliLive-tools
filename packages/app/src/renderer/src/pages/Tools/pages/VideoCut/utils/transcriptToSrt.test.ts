// @vitest-environment node
import { describe, expect, it } from "vitest";

import { convertAsrTranscriptToSrt, parseAsrTranscript } from "./transcriptToSrt";

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

  it("rejects invalid time ranges", () => {
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
});
