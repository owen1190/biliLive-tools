import { describe, expect, it } from "vitest";

import {
  buildSessionTranscript,
  resolveLiveSummarySessionClips,
  type LiveSummarySessionClip,
} from "../../src/task/liveSummarySession.js";

const clip = (overrides: Partial<LiveSummarySessionClip>): LiveSummarySessionClip => ({
  id: 1,
  streamer_id: 10,
  live_id: "live-1",
  record_start_time: 3000,
  title: "整场直播",
  video_file: "/record/part-2.flv",
  ...overrides,
});

describe("live summary session helpers", () => {
  it("sorts same-live clips by record start time and skips clips without a video file", () => {
    const target = clip({ id: 2, record_start_time: 3000, video_file: "/record/part-2.flv" });
    const sessionClips = [
      target,
      clip({ id: 1, record_start_time: 1000, video_file: "/record/part-1.flv" }),
      clip({ id: 3, record_start_time: 2000, video_file: undefined }),
    ];

    expect(resolveLiveSummarySessionClips(target, sessionClips).map((item) => item.id)).toEqual([
      1, 2,
    ]);
  });

  it("falls back to the selected record when live id is missing", () => {
    const target = clip({ id: 7, live_id: undefined, video_file: "/record/current.flv" });

    expect(resolveLiveSummarySessionClips(target, [clip({ id: 8, video_file: "/record/other.flv" })])).toEqual([
      target,
    ]);
  });

  it("builds a full-session transcript with clip boundaries", () => {
    const transcript = buildSessionTranscript([
      {
        clip: clip({
          id: 1,
          record_start_time: 1781105107602,
          video_file: "/record/part-1.flv",
        }),
        transcript: "[00:00:00-00:00:02] 开场",
      },
      {
        clip: clip({
          id: 2,
          record_start_time: 1781108707602,
          video_file: "/record/part-2.flv",
        }),
        transcript: "[00:00:00-00:00:02] 下半场",
      },
    ]);

    expect(transcript).toContain("片段 1/2");
    expect(transcript).toContain("part-1.flv");
    expect(transcript).toContain("[00:00:00-00:00:02] 开场");
    expect(transcript).toContain("片段 2/2");
    expect(transcript).toContain("part-2.flv");
    expect(transcript).toContain("[00:00:00-00:00:02] 下半场");
  });
});
