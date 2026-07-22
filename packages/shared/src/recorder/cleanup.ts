import path from "node:path";
import type { Dirent } from "node:fs";

import fs from "fs-extra";

import { trashItem } from "../utils/index.js";

export const RECORDING_VIDEO_EXTENSIONS = new Set([
  ".flv",
  ".m4s",
  ".mkv",
  ".mp4",
  ".ts",
  ".webm",
]);

export type RecordingCleanupResult = {
  enabled: boolean;
  scanned: number;
  eligible: number;
  deleted: number;
  skippedProtected: number;
  errors: Array<{ filePath: string; error: unknown }>;
};

type RecordingCleanupOptions = {
  rootPath: string;
  retentionDays: number;
  protectedPaths?: string[];
  now?: number;
  removeFile?: (filePath: string) => Promise<void>;
};

const emptyResult = (enabled: boolean): RecordingCleanupResult => ({
  enabled,
  scanned: 0,
  eligible: 0,
  deleted: 0,
  skippedProtected: 0,
  errors: [],
});

const isProtectedPath = (filePath: string, protectedPaths: string[]) => {
  const normalizedFilePath = path.resolve(filePath);

  return protectedPaths.some((protectedPath) => {
    const normalizedProtectedPath = path.resolve(protectedPath);
    return (
      normalizedFilePath === normalizedProtectedPath ||
      normalizedFilePath.startsWith(`${normalizedProtectedPath}.`) ||
      normalizedFilePath.startsWith(`${normalizedProtectedPath}-`)
    );
  });
};

const collectVideoFiles = async (rootPath: string): Promise<string[]> => {
  const files: string[] = [];
  const pendingDirectories = [rootPath];

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (!currentDirectory) continue;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (RECORDING_VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(entryPath);
      }
    }
  }

  return files;
};

export const cleanupOldRecordings = async ({
  rootPath,
  retentionDays,
  protectedPaths = [],
  now = Date.now(),
  removeFile = trashItem,
}: RecordingCleanupOptions): Promise<RecordingCleanupResult> => {
  if (!rootPath || !Number.isFinite(retentionDays) || retentionDays <= 0) {
    return emptyResult(false);
  }

  if (!(await fs.pathExists(rootPath))) {
    return emptyResult(true);
  }

  const result = emptyResult(true);
  const cutoffTime = now - retentionDays * 24 * 60 * 60 * 1000;
  const videoFiles = await collectVideoFiles(rootPath);
  result.scanned = videoFiles.length;

  for (const filePath of videoFiles) {
    let modifiedTime: number;
    try {
      modifiedTime = (await fs.stat(filePath)).mtimeMs;
    } catch (error) {
      result.errors.push({ filePath, error });
      continue;
    }

    if (modifiedTime >= cutoffTime) continue;
    result.eligible += 1;

    if (isProtectedPath(filePath, protectedPaths)) {
      result.skippedProtected += 1;
      continue;
    }

    try {
      await removeFile(filePath);
      result.deleted += 1;
    } catch (error) {
      result.errors.push({ filePath, error });
    }
  }

  return result;
};
