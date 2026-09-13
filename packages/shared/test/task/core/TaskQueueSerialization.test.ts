import { afterEach, expect, it, vi } from "vitest";

// Isolate serialization from recorder/native module initialization in utils.
vi.mock("../../../src/utils/index.js", () => ({
  uuid: () => "test-task",
  isBetweenTimeRange: () => true,
}));
import { AbstractTask } from "../../../src/task/core/AbstractTask.js";
import { TaskQueue } from "../../../src/task/core/TaskQueue.js";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("omits logs from lightweight lists but preserves log availability and task details", () => {
  vi.useFakeTimers();
  class TestTask extends AbstractTask {
    type = "ffmpeg";
    exec() {}
    pause() {}
    resume() {}
    kill() {}
  }
  const queue = new TaskQueue({ getAll: () => ({}) } as TaskQueue["appConfig"]);
  const task = new TestTask();
  task.logs = [{ time: 1, level: "info", message: "upload started" }];
  const [summary] = queue.stringify([task], { includeLogs: false });
  expect(summary.logs).toBeUndefined();
  expect(summary.logCount).toBe(1);
  expect(queue.stringify([task])[0].logs).toEqual(task.logs);
  expect(task.logs).toHaveLength(1);
});
