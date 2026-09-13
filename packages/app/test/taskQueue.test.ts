// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createQueueLoader, groupByPid } from "../src/renderer/src/utils/taskQueue";
import type { Task } from "../src/renderer/src/types";

const task = (taskId: string, pid?: string): Task => ({
  taskId,
  pid,
  name: taskId,
  type: "ffmpeg" as Task["type"],
  status: "completed",
  progress: 100,
  action: [],
  duration: 1000,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("queue grouping", () => {
  it("preserves order and groups children even when they precede the parent", () => {
    const child = task("child", "parent");
    const parent = task("parent");
    const other = task("other");
    const grouped = groupByPid([child, other, parent]);
    expect(grouped.map((item) => item.taskId)).toEqual(["other", "parent"]);
    expect(grouped[1].children?.map((item) => item.taskId)).toEqual(["child"]);
    expect(parent.children).toBeUndefined();
    expect(groupByPid([child, parent])[0].children).toHaveLength(1);
  });

  it("does not copy large log payloads during grouping", () => {
    const parent = task("parent");
    parent.logs = [{ time: 1, level: "info", message: "long log" }];
    expect(groupByPid([parent])[0].logs).toBe(parent.logs);
  });

  it("keeps matching children visible when their parent was filtered out", () => {
    expect(groupByPid([task("child", "hidden-parent")]).map((item) => item.taskId)).toEqual([
      "child",
    ]);
  });
});

describe("queue loading", () => {
  it("coalesces concurrent refreshes and applies the final refresh after a task action", async () => {
    const first = deferred<Task[]>();
    const second = deferred<Task[]>();
    let calls = 0;
    const applied: string[][] = [];
    const refresh = createQueueLoader(
      () => (++calls === 1 ? first.promise : second.promise),
      () => "",
      (tasks) => applied.push(tasks.map((item) => item.taskId)),
    );
    const pending = refresh();
    const afterAction = refresh();
    const poll = refresh();
    expect(calls).toBe(1);
    first.resolve([task("before-action")]);
    await Promise.resolve();
    expect(calls).toBe(2);
    second.resolve([task("after-action")]);
    await Promise.all([pending, afterAction, poll]);
    expect(applied.at(-1)).toEqual(["after-action"]);
    expect(calls).toBe(2);
  });

  it("discards the response for an old filter and fetches the latest filter", async () => {
    const first = deferred<Task[]>();
    let type = "ffmpeg";
    const requested: string[] = [];
    const applied: string[][] = [];
    const refresh = createQueueLoader(
      (filter) => {
        requested.push(filter);
        return filter === "ffmpeg" ? first.promise : Promise.resolve([task("upload")]);
      },
      () => type,
      (tasks) => applied.push(tasks.map((item) => item.taskId)),
    );
    const pending = refresh();
    type = "bili";
    const updated = refresh();
    first.resolve([task("stale")]);
    await Promise.all([pending, updated]);
    expect(requested).toEqual(["ffmpeg", "bili"]);
    expect(applied).toEqual([["upload"]]);
  });

  it("allows another refresh after a failed request", async () => {
    let failed = true;
    let applied: Task[] = [];
    const refresh = createQueueLoader(
      async () => {
        if (failed) throw new Error("offline");
        return [task("recovered")];
      },
      () => "",
      (tasks) => {
        applied = tasks;
      },
    );
    await expect(refresh()).rejects.toThrow("offline");
    failed = false;
    await refresh();
    expect(applied.map((item) => item.taskId)).toEqual(["recovered"]);
  });
});
