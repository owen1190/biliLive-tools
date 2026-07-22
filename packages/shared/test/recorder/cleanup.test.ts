import path from "node:path";
import os from "node:os";

import fs from "fs-extra";

import { cleanupOldRecordings } from "../../src/recorder/cleanup.js";

describe("cleanupOldRecordings", () => {
  let tempDirectory: string;

  beforeEach(async () => {
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "bili-live-cleanup-"));
  });

  afterEach(async () => {
    await fs.remove(tempDirectory);
  });

  it("cleans old video files and keeps recent files and sidecars", async () => {
    const oldVideo = path.join(tempDirectory, "old.mp4");
    const recentVideo = path.join(tempDirectory, "recent.mp4");
    const sidecar = path.join(tempDirectory, "old.xml");
    const now = Date.now();
    const oldTime = new Date(now - 10 * 24 * 60 * 60 * 1000);

    await fs.outputFile(oldVideo, "old");
    await fs.outputFile(recentVideo, "recent");
    await fs.outputFile(sidecar, "xml");
    await fs.utimes(oldVideo, oldTime, oldTime);

    const removed: string[] = [];
    const result = await cleanupOldRecordings({
      rootPath: tempDirectory,
      retentionDays: 7,
      now,
      removeFile: async (filePath) => {
        removed.push(filePath);
      },
    });

    expect(result).toMatchObject({ scanned: 2, eligible: 1, deleted: 1, skippedProtected: 0 });
    expect(removed).toEqual([oldVideo]);
    expect(await fs.pathExists(sidecar)).toBe(true);
  });

  it("does not remove a protected active or uploading file", async () => {
    const activeVideo = path.join(tempDirectory, "active.mp4");
    const uploadingVideo = path.join(tempDirectory, "uploading.mp4");
    const now = Date.now();
    const oldTime = new Date(now - 10 * 24 * 60 * 60 * 1000);

    await fs.outputFile(activeVideo, "active");
    await fs.outputFile(uploadingVideo, "uploading");
    await fs.utimes(activeVideo, oldTime, oldTime);
    await fs.utimes(uploadingVideo, oldTime, oldTime);

    const result = await cleanupOldRecordings({
      rootPath: tempDirectory,
      retentionDays: 7,
      now,
      protectedPaths: [activeVideo.replace(/\.mp4$/, ""), uploadingVideo],
      removeFile: async () => undefined,
    });

    expect(result).toMatchObject({ scanned: 2, eligible: 2, deleted: 0, skippedProtected: 2 });
  });
});
