<template>
  <div class="dashboard-shell">
    <header class="dashboard-header">
      <div>
        <div class="eyebrow">整体概览</div>
        <h1>从录制到归档的完整工作流</h1>
        <p>监控直播录制、处理队列、上传诊断和 AI 摘要状态。</p>
      </div>
      <div class="header-actions">
        <n-button quaternary class="soft-button" @click="getTime">
          <template #icon>
            <n-icon><RefreshOutline /></n-icon>
          </template>
          刷新
        </n-button>
        <n-button class="soft-button" @click="whyUploadFailed">
          <template #icon>
            <n-icon><WarningOutline /></n-icon>
          </template>
          上传诊断
        </n-button>
        <n-button type="primary" @click="navigateToRecorder">
          <template #icon>
            <n-icon><VideocamOutline /></n-icon>
          </template>
          新增录制
        </n-button>
      </div>
    </header>

    <section class="workflow-strip">
      <div class="section-title">
        <span>今日任务流</span>
        <small>自动更新运行时长和任务数量</small>
      </div>
      <div class="workflow-steps">
        <button
          v-for="(step, index) in workflowSteps"
          :key="step.label"
          class="workflow-step"
          type="button"
          @click="step.action"
        >
          <span class="step-label">{{ step.label }}</span>
          <strong :style="{ color: step.color }">{{ step.value }}</strong>
          <i v-if="index < workflowSteps.length - 1"></i>
        </button>
      </div>
    </section>

    <div class="overview-grid">
      <section class="surface today-panel">
        <div class="section-title">
          <span>今日直播</span>
          <small>录制状态与存储健康</small>
        </div>
        <div class="live-list">
          <button
            v-for="item in todayLives"
            :key="item.name"
            class="live-row"
            type="button"
            @click="item.action"
          >
            <span class="live-avatar" :style="{ background: item.tint }">
              <n-icon><component :is="item.icon" /></n-icon>
            </span>
            <span class="live-main">
              <strong>{{ item.name }}</strong>
              <small>{{ item.meta }}</small>
            </span>
            <span class="status-pill" :class="item.tone">{{ item.status }}</span>
          </button>
        </div>
      </section>

      <aside class="surface quick-panel">
        <div class="section-title">
          <span>快捷设置</span>
          <small>常用能力开关</small>
        </div>
        <div class="quick-list">
          <button class="quick-row" type="button" @click="navigateToRecorder">
            <span>默认输出目录</span>
            <b>已配置</b>
          </button>
          <button class="quick-row" type="button" @click="navigateToRecorder">
            <span>自动录制</span>
            <b class="enabled">开启</b>
          </button>
          <button class="quick-row" type="button" @click="openAiSetting">
            <span>完成后 AI 摘要</span>
            <b class="enabled">开启</b>
          </button>
          <button class="quick-row" type="button" @click="openWebhookSetting">
            <span>Webhook 通知</span>
            <b>按规则</b>
          </button>
        </div>
      </aside>
    </div>

    <section class="surface queue-panel">
      <div class="section-title">
        <span>处理队列</span>
        <small>{{ runningTaskNum }} 个任务正在运行</small>
      </div>
      <div class="queue-list">
        <button
          v-for="task in queuePreview"
          :key="task.name"
          class="queue-row"
          type="button"
          @click="navigateToQueue"
        >
          <span class="queue-name">{{ task.name }}</span>
          <span class="progress-track">
            <span class="progress-bar" :style="{ width: `${task.progress}%`, background: task.color }"></span>
          </span>
          <span class="queue-value">{{ task.value }}</span>
        </button>
      </div>
    </section>

    <section class="surface recent-panel">
      <div class="section-title">
        <span>最近记录</span>
        <small>转写下载与摘要状态</small>
      </div>
      <div class="recent-table">
        <div class="recent-row recent-head">
          <span>主播</span>
          <span>标题</span>
          <span>转写</span>
          <span>摘要</span>
        </div>
        <button
          v-for="record in recentRecords"
          :key="record.title"
          class="recent-row"
          type="button"
          @click="navigateToLiveHistory"
        >
          <span>{{ record.streamer }}</span>
          <span>{{ record.title }}</span>
          <span class="link-like">{{ record.transcript }}</span>
          <span :class="record.summaryClass">{{ record.summary }}</span>
        </button>
      </div>
    </section>
  </div>

  <n-modal v-model:show="roomIdModalVisible" :mask-closable="false" auto-focus>
    <n-card style="width: 500px; max-width: 92vw" :bordered="false" role="dialog" aria-modal="true">
      <template #header>
        <div style="font-size: 16px; font-weight: bold">输入直播间号</div>
      </template>
      <n-input
        v-model:value="roomIdInput"
        placeholder="请输入直播间号"
        maxlength="20"
        @keyup.enter="handleRoomIdConfirm"
      />
      <template #footer>
        <div style="text-align: right">
          <n-button @click="roomIdModalVisible = false">取消</n-button>
          <n-button type="primary" style="margin-left: 10px" @click="handleRoomIdConfirm">
            确认
          </n-button>
        </div>
      </template>
    </n-card>
  </n-modal>

  <n-modal v-model:show="resultModalVisible" :mask-closable="false" auto-focus>
    <n-card style="width: 600px; max-width: 92vw" :bordered="false" role="dialog" aria-modal="true">
      <template #header>
        <div style="font-size: 16px; font-weight: bold">检测结果</div>
      </template>
      <div v-if="checkResult">
        <div
          :class="checkResult.hasError ? 'result-error' : 'result-success'"
          class="result-status"
        >
          {{ checkResult.hasError ? "发现问题" : "配置正常" }}
        </div>
        <div class="result-info">
          {{ checkResult.errorInfo }}
        </div>
      </div>
      <template #footer>
        <div style="text-align: right">
          <n-button type="primary" @click="resultModalVisible = false">关闭</n-button>
        </div>
      </template>
    </n-card>
  </n-modal>
</template>

<script setup lang="ts">
import { commonApi } from "@renderer/apis";
import eventBus from "@renderer/utils/eventBus";
import { useQueueStore } from "@renderer/stores";
import { useRouter } from "vue-router";
import {
  ArchiveOutline,
  FolderOpenOutline,
  RefreshOutline,
  VideocamOutline,
  WarningOutline,
} from "@vicons/ionicons5";

import type { Component } from "vue";

defineOptions({
  name: "Dashboard",
});

const router = useRouter();
const quenuStore = useQueueStore();
const runningTaskNum = computed(() => quenuStore.runningTaskNum);
const statistics = ref<{
  startTime: number | null;
  videoTotalDuaration: number | null;
  recordingNum: number;
  recorderNum: number;
}>({
  startTime: null,
  videoTotalDuaration: null,
  recordingNum: 0,
  recorderNum: 0,
});

const diskSpace = ref<{
  total: number;
  free: number;
  used: number;
  usedPercentage: number;
} | null>(null);

const getTime = async () => {
  const data = await commonApi.appStatistics();
  statistics.value = data;
  try {
    const diskData = await commonApi.getDiskSpace();
    diskSpace.value = diskData;
  } catch (error) {
    console.error("获取磁盘空间失败:", error);
    diskSpace.value = null;
  }
};

const now = ref(Date.now());

const formatTime = (time: number) => {
  const seconds = Math.floor((time / 1000) % 60);
  const minutes = Math.floor((time / 1000 / 60) % 60);
  const hours = Math.floor((time / 1000 / 60 / 60) % 24);
  const days = Math.floor(time / 1000 / 60 / 60 / 24);

  if (days > 0) {
    return `${days}天${hours}小时${minutes}分钟`;
  }
  return `${hours}小时${minutes}分钟${seconds}秒`;
};

const runtimeText = computed(() => formatTime(now.value - (statistics.value.startTime || now.value)));
const diskStatus = computed(() => {
  if (!diskSpace.value) {
    return {
      text: "未获取磁盘信息",
      tone: "neutral",
    };
  }
  if (diskSpace.value.free < 5) {
    return {
      text: `剩余 ${diskSpace.value.free.toFixed(2)}GB`,
      tone: "warning",
    };
  }
  return {
    text: `剩余 ${diskSpace.value.free.toFixed(2)}GB · 已用 ${diskSpace.value.usedPercentage.toFixed(1)}%`,
    tone: "success",
  };
});

const workflowSteps = computed(() => [
  {
    label: "录制中",
    value: statistics.value.recordingNum || 0,
    color: "#18a058",
    action: navigateToRecorder,
  },
  {
    label: "转码中",
    value: runningTaskNum.value,
    color: "#2f80ed",
    action: navigateToQueue,
  },
  {
    label: "上传中",
    value: runningTaskNum.value > 0 ? 1 : 0,
    color: "#7c5cff",
    action: navigateToQueue,
  },
  {
    label: "AI摘要",
    value: "就绪",
    color: "#8b5cf6",
    action: openAiSetting,
  },
  {
    label: "已归档",
    value: statistics.value.recorderNum || 0,
    color: "#6b7280",
    action: navigateToLiveHistory,
  },
]);

const todayLives = computed<
  {
    name: string;
    meta: string;
    status: string;
    tone: string;
    tint: string;
    icon: Component;
    action: () => void;
  }[]
>(() => [
  {
    name: "正在录制",
    meta: `${statistics.value.recordingNum || 0} 个直播间 · 运行 ${runtimeText.value}`,
    status: statistics.value.recordingNum > 0 ? "录制中" : "待机",
    tone: statistics.value.recordingNum > 0 ? "success" : "neutral",
    tint: "#e0f4e9",
    icon: VideocamOutline,
    action: navigateToRecorder,
  },
  {
    name: "主播库",
    meta: `${statistics.value.recorderNum || 0} 位主播 · 规则持续同步`,
    status: "可管理",
    tone: "success",
    tint: "#e5effb",
    icon: FolderOpenOutline,
    action: navigateToRecorder,
  },
  {
    name: "录制磁盘",
    meta: diskStatus.value.text,
    status: diskStatus.value.tone === "warning" ? "需关注" : "健康",
    tone: diskStatus.value.tone,
    tint: "#f2eafe",
    icon: ArchiveOutline,
    action: getTime,
  },
]);

const queuePreview = computed(() => [
  {
    name: "运行任务",
    progress: Math.min(100, Math.max(12, runningTaskNum.value * 18)),
    value: `${runningTaskNum.value} 个`,
    color: "#2f80ed",
  },
  {
    name: "最近30天录制",
    progress: Math.min(100, Math.max(20, (statistics.value.videoTotalDuaration || 0) / 3600)),
    value: formatTime((statistics.value.videoTotalDuaration || 0) * 1000),
    color: "#7c5cff",
  },
  {
    name: "摘要与归档",
    progress: statistics.value.recorderNum ? 74 : 28,
    value: statistics.value.recorderNum ? "已就绪" : "待配置",
    color: "#8b5cf6",
  },
]);

const recentRecords = [
  {
    streamer: "最近直播",
    title: "直播录制完成后会在这里快速归档",
    transcript: "下载转写",
    summary: "生成摘要",
    summaryClass: "link-like",
  },
  {
    streamer: "任务队列",
    title: "转码、上传、AI 摘要统一跟踪",
    transcript: "转写中",
    summary: "等待",
    summaryClass: "muted",
  },
  {
    streamer: "历史文件",
    title: "打开最近记录查看完整明细",
    transcript: "打开目录",
    summary: "已归档",
    summaryClass: "success-text",
  },
];

let intervalId: NodeJS.Timeout | null = null;
const createInterval = () => {
  if (intervalId) return;
  intervalId = setInterval(() => {
    now.value = Date.now();
  }, 1000);
};
function cleanInterval() {
  intervalId && clearInterval(intervalId);
  intervalId = null;
}

let eventSource: EventSource | null = null;
async function getRunningTaskNum() {
  if (eventSource && eventSource?.readyState !== 2) return;
  eventSource = await commonApi.getRunningTaskNum();

  eventSource.onmessage = function (event) {
    const data = JSON.parse(event.data || "{}");
    quenuStore.setRunningTaskNum(data.num);
  };
}

onActivated(() => {
  getTime();
  createInterval();
  getRunningTaskNum();
});

onDeactivated(() => {
  cleanInterval();
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
});

const notice = useNotice();

const roomIdModalVisible = ref(false);
const roomIdInput = ref("");
const resultModalVisible = ref(false);
const checkResult = ref<{ hasError: boolean; errorInfo: string } | null>(null);

const whyUploadFailed = () => {
  roomIdInput.value = "";
  roomIdModalVisible.value = true;
};

const handleRoomIdConfirm = async () => {
  if (!roomIdInput.value.trim()) {
    notice.warning("请输入直播间号");
    return;
  }

  roomIdModalVisible.value = false;

  try {
    const res = await commonApi.whyUploadFailed(roomIdInput.value.trim());
    checkResult.value = res;
    resultModalVisible.value = true;
  } catch (error) {
    notice.error("检测失败，请检查直播间号是否正确");
  }
};

const navigateToRecorder = () => {
  router.push({ name: "recorder" });
};

const navigateToQueue = () => {
  router.push({ name: "Queue" });
};

const navigateToLiveHistory = () => {
  router.push({ name: "LiveHistory" });
};

const openAiSetting = () => {
  eventBus.emit("open-setting-dialog", { extra: undefined });
};

const openWebhookSetting = () => {
  eventBus.emit("open-setting-dialog", { extra: undefined });
};
</script>

<style scoped lang="less">
.dashboard-shell {
  min-height: 100%;
  padding: 30px 40px 44px;
  background: #f8f7f3;
  color: #171512;
  box-sizing: border-box;
  overflow-x: hidden;
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: flex-start;
  margin-bottom: 34px;

  > div:first-child {
    min-width: 0;
  }

  h1 {
    margin: 6px 0 8px;
    font-size: 28px;
    font-weight: 700;
    letter-spacing: 0;
  }

  p {
    margin: 0;
    color: #766f67;
    font-size: 14px;
  }
}

.eyebrow {
  color: #18a058;
  font-size: 13px;
  font-weight: 700;
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;

  :deep(.n-button) {
    min-height: 38px;
  }
}

.soft-button {
  background: #ffffff;
  border: 1px solid #e7e2da;
  color: #1f1c18;
  --n-text-color: #1f1c18 !important;
  --n-text-color-hover: #1f1c18 !important;
  --n-text-color-pressed: #1f1c18 !important;
  --n-text-color-focus: #1f1c18 !important;
  --n-border: 1px solid #e7e2da !important;
  --n-border-hover: 1px solid #cfc7bb !important;
  --n-border-pressed: 1px solid #bdb4a8 !important;
  --n-border-focus: 1px solid #cfc7bb !important;
}

.workflow-strip,
.surface {
  border: 1px solid #e7e2da;
  border-radius: 10px;
  background: #ffffff;
  box-sizing: border-box;
}

.workflow-strip {
  padding: 22px 24px 24px;
  margin-bottom: 28px;
}

.section-title {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: baseline;
  margin-bottom: 20px;

  span {
    color: #171512;
    font-size: 20px;
    font-weight: 700;
  }

  small {
    color: #8a8178;
    font-size: 12px;
  }
}

.workflow-steps {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 16px;
}

.workflow-step {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 52px;
  padding: 0 18px;
  border: 1px solid #ece7df;
  border-radius: 8px;
  background: #fafaf8;
  color: #514b45;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    transform 0.2s ease;

  &:hover {
    border-color: #cfc7bb;
    transform: translateY(-1px);
  }

  strong {
    font-size: 24px;
    font-weight: 700;
    white-space: nowrap;
  }

  i {
    position: absolute;
    right: -18px;
    width: 18px;
    height: 2px;
    background: #ddd7ce;
  }
}

.step-label {
  font-size: 14px;
  font-weight: 600;
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr);
  gap: 28px;
  margin-bottom: 28px;
}

.surface {
  padding: 22px 24px;
}

.live-list,
.quick-list,
.queue-list,
.recent-table {
  display: flex;
  flex-direction: column;
}

.live-row,
.quick-row,
.queue-row,
.recent-row {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

.live-row {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  min-height: 58px;
  padding: 9px 0;
  border-top: 1px solid #f0ece5;
  cursor: pointer;
  min-width: 0;

  &:first-child {
    border-top: 0;
  }
}

.live-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 8px;
  color: #171512;
  font-size: 19px;
}

.live-main {
  display: flex;
  flex-direction: column;
  min-width: 0;

  strong {
    color: #1f1c18;
    font-size: 15px;
  }

  small {
    margin-top: 4px;
    overflow: hidden;
    color: #827a72;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: #f0ece5;
  color: #625b54;
  font-size: 12px;
  font-weight: 700;

  &.success {
    background: #eaf7ef;
    color: #147c47;
  }

  &.warning {
    background: #fff4d6;
    color: #a56600;
  }
}

.quick-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 42px;
  border-top: 1px solid #f0ece5;
  cursor: pointer;

  &:first-child {
    border-top: 0;
  }

  span {
    color: #514b45;
    min-width: 0;
  }

  b {
    flex: 0 0 auto;
    color: #766f67;
    font-size: 13px;

    &.enabled {
      color: #18a058;
    }
  }
}

.queue-panel,
.recent-panel {
  margin-bottom: 28px;
}

.queue-row {
  display: grid;
  grid-template-columns: 280px minmax(160px, 1fr) 120px;
  gap: 24px;
  align-items: center;
  min-height: 38px;
  cursor: pointer;
}

.queue-name {
  color: #1f1c18;
  font-weight: 600;
  min-width: 0;
}

.progress-track {
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: #efeae2;
}

.progress-bar {
  display: block;
  height: 100%;
  border-radius: inherit;
}

.queue-value {
  color: #625b54;
  font-size: 13px;
  font-weight: 600;
}

.recent-row {
  display: grid;
  grid-template-columns: 170px minmax(260px, 1fr) 160px 160px;
  gap: 24px;
  align-items: center;
  min-height: 40px;
  border-top: 1px solid #f0ece5;
  cursor: pointer;
  min-width: 0;

  &.recent-head {
    min-height: 30px;
    border-top: 0;
    color: #8a8178;
    cursor: default;
    font-size: 12px;
    font-weight: 700;
  }
}

.link-like,
.success-text {
  color: #18a058;
  font-weight: 700;
}

.muted {
  color: #8a8178;
}

.result-status {
  margin-bottom: 12px;
  font-size: 16px;
  font-weight: 500;

  &.result-error {
    color: var(--color-error);
  }

  &.result-success {
    color: var(--color-success);
  }
}

.result-info {
  margin-top: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
}

@media (max-width: 1100px) {
  .dashboard-shell {
    padding: 24px;
  }

  .dashboard-header,
  .overview-grid {
    grid-template-columns: 1fr;
  }

  .dashboard-header {
    flex-direction: column;
  }

  .header-actions {
    justify-content: flex-start;
  }

  .workflow-steps {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .workflow-step i {
    display: none;
  }

  .queue-row,
  .recent-row {
    grid-template-columns: 1fr;
    gap: 8px;
    padding: 12px 0;
  }
}

@media (max-width: 640px) {
  .dashboard-shell {
    padding: 16px 12px 26px;
  }

  .dashboard-header {
    gap: 18px;
    margin-bottom: 22px;

    h1 {
      font-size: 22px;
      line-height: 1.25;
    }

    p {
      font-size: 13px;
      line-height: 1.6;
    }
  }

  .header-actions {
    display: grid;
    grid-template-columns: 1fr;
    width: 100%;
    gap: 8px;

    :deep(.n-button) {
      width: 100%;
      justify-content: center;
      min-height: 42px;
    }
  }

  .workflow-strip,
  .surface {
    border-radius: 8px;
  }

  .workflow-strip,
  .surface {
    padding: 16px 14px;
  }

  .section-title {
    flex-direction: column;
    gap: 4px;
    margin-bottom: 16px;

    span {
      font-size: 18px;
    }
  }

  .workflow-steps {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .workflow-step {
    min-height: 48px;
    padding: 0 14px;

    strong {
      font-size: 22px;
    }
  }

  .overview-grid,
  .queue-panel,
  .recent-panel {
    gap: 14px;
    margin-bottom: 14px;
  }

  .live-row {
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 12px;
    align-items: flex-start;
    padding: 12px 0;
  }

  .live-avatar {
    width: 34px;
    height: 34px;
  }

  .status-pill {
    grid-column: 2;
    justify-self: flex-start;
    min-height: 24px;
    margin-top: 6px;
    padding: 0 10px;
  }

  .quick-row {
    min-height: 46px;

    span,
    b {
      line-height: 1.35;
    }
  }

  .queue-row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px 14px;
    min-height: 48px;
  }

  .progress-track {
    grid-column: 1 / -1;
  }

  .queue-value {
    text-align: right;
  }

  .recent-head {
    display: none;
  }

  .recent-row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px 12px;
    min-height: auto;
    padding: 12px 0;

    span {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    span:nth-child(2) {
      grid-column: 1 / -1;
      color: #625b54;
      font-size: 13px;
      line-height: 1.5;
    }
  }
}

@media (max-width: 420px) {
  .dashboard-shell {
    padding: 14px 10px 24px;
  }

  .dashboard-header h1 {
    font-size: 20px;
  }

  .workflow-strip,
  .surface {
    padding: 14px 12px;
  }

  .section-title span {
    font-size: 17px;
  }
}
</style>
