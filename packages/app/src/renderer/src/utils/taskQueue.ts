import type { Task } from "@renderer/types";

export function groupByPid(data: Task[]): Task[] {
  const list = data.map((item) => ({ ...item, children: undefined as Task[] | undefined }));
  const byId = new Map(list.map((item) => [item.taskId, item]));
  const roots: Task[] = [];
  for (const item of list) {
    const parent = item.pid ? byId.get(item.pid) : undefined;
    if (parent && parent !== item) (parent.children ??= []).push(item);
    else roots.push(item);
  }
  return roots;
}

export function createQueueLoader(
  fetchTasks: (type: string) => Promise<Task[]>,
  getType: () => string,
  applyTasks: (tasks: Task[]) => void,
) {
  let inFlight: Promise<void> | null = null;
  let refreshRequested = false;
  return () => {
    if (inFlight) {
      refreshRequested = true;
      return inFlight;
    }
    inFlight = (async () => {
      do {
        refreshRequested = false;
        const type = getType();
        const tasks = await fetchTasks(type);
        if (type === getType()) applyTasks(tasks);
        else refreshRequested = true;
      } while (refreshRequested);
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
