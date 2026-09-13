<template>
  <div class="container">
    <div style="display: flex; align-items: center">
      <n-select
        v-model:value="store.params.type"
        :options="typeOptions"
        style="width: 140px; margin-right: 10px"
        size="small"
      />
      <n-checkbox-group v-model:value="selectedStatus">
        <n-checkbox value="pending">未开始</n-checkbox>
        <n-checkbox value="running">运行中</n-checkbox>
        <n-checkbox value="paused">已暂停</n-checkbox>
        <n-checkbox value="completed">已完成</n-checkbox>
        <n-checkbox value="error">错误</n-checkbox>
        <n-checkbox value="canceled">已取消</n-checkbox>
      </n-checkbox-group>

      <div style="margin-left: auto; display: flex; gap: 10px">
        <n-button v-if="queue.length !== 0" size="small" type="primary" @click="handlePauseTasks"
          >暂停全部</n-button
        >
        <n-button v-if="queue.length !== 0" size="small" type="error" @click="handleRemoveEndTasks"
          >清除记录</n-button
        >
      </div>
    </div>
    <n-virtual-list
      v-if="displayRows.length !== 0"
      class="queue-list"
      :items="displayRows"
      :item-size="96"
      item-resizable
    >
      <template #default="{ item: row }">
        <div class="item" :class="{ 'sub-item': row.isChild }">
          <Item
            :item="row.task"
            :show-progress="!row.task.children?.length"
            :show-info="!row.task.children?.length"
          />
        </div>
      </template>
    </n-virtual-list>
    <template v-else>
      <h2>暂无任务，快去添加一个试试吧</h2>
    </template>
  </div>
</template>

<script setup lang="ts">
defineOptions({
  name: "Queue",
});
import Item from "./components/item.vue";
import { useQueueStore } from "@renderer/stores";
import { groupByPid } from "@renderer/utils/taskQueue";
import { taskApi } from "@renderer/apis";
import { TaskType } from "@biliLive-tools/shared/enum.js";

const notice = useNotification();
const store = useQueueStore();

const queue = computed(() => store.queue);

const displayQueue = computed(() => {
  const filterData = queue.value.filter((item) => selectedStatus.value.includes(item.status));
  const data = groupByPid(filterData);
  return data;
});

const displayRows = computed(() =>
  displayQueue.value.flatMap((task) => [
    { key: task.taskId, task, isChild: false },
    ...(task.children ?? []).map((child) => ({ key: child.taskId, task: child, isChild: true })),
  ]),
);

const typeOptions = ref([
  {
    value: "",
    label: "全部",
  },
  {
    value: TaskType.ffmpeg,
    label: "FFmpeg处理",
  },
  {
    value: TaskType.bili,
    label: "B站上传",
  },
  {
    value: TaskType.biliUpload,
    label: "B站分P上传",
  },
  {
    value: TaskType.danmu,
    label: "弹幕转换",
  },
  {
    value: TaskType.biliDownload,
    label: "B站视频下载",
  },
  {
    value: TaskType.douyuDownload,
    label: "斗鱼视频下载",
  },
  {
    value: TaskType.sync,
    label: "同步",
  },
]);

const selectedStatus = ref<string[]>([
  "pending",
  "running",
  "paused",
  "completed",
  "error",
  "canceled",
]);

const handleRemoveEndTasks = async () => {
  const taskIds: string[] = [];
  const byId = new Map(queue.value.map((item) => [item.taskId, item]));
  for (const item of queue.value) {
    if (item.status === "completed" || item.status === "canceled") {
      // 如果任务有pid，那么判断pid对应的任务未被完成或取消，那么不删除
      if (item.pid) {
        const pTask = byId.get(item.pid);
        if (pTask && !["completed", "canceled"].includes(pTask.status)) {
          continue;
        }
      }
      taskIds.push(item.taskId);
    }
  }
  await taskApi.removeBatch(taskIds);

  notice.success({
    title: "移除成功",
    duration: 1000,
  });
  await store.getQuenu();
};

const handlePauseTasks = async () => {
  for (const item of queue.value) {
    if (item.status === "running") {
      await taskApi.pause(item.taskId);
    }
  }
  await store.getQuenu();
};

let timer: ReturnType<typeof setTimeout> | null = null;
let active = false;
let polling = false;
async function pollQueue() {
  if (!active || polling) return;
  polling = true;
  try {
    if (!document.hidden) await store.getQuenu();
  } catch (error) {
    console.error("刷新任务队列失败", error);
  } finally {
    polling = false;
    if (active) timer = setTimeout(pollQueue, window.isWeb ? 2000 : 1000);
  }
}
function stopPolling() {
  active = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

onDeactivated(() => {
  stopPolling();
});

onBeforeUnmount(stopPolling);

onActivated(() => {
  active = true;
  void pollQueue();
});
</script>

<style scoped lang="less">
.container {
  display: flex;
  flex-direction: column;
  gap: 10px;
  .queue-list {
    height: calc(100dvh - 120px);
    min-height: 200px;
  }
  .item {
    border-bottom: 1px solid #eee;
    padding: 10px 5px;
    padding-top: 0;
  }
  .sub-item {
    padding-left: 20px;
  }
}
</style>
