<template>
  <div class="container">
    <n-spin :show="loading">
      <h2>
        支持B站视频、B站剪辑回放、斗鱼录播、虎牙录播、抖音录播、快手录播下载；斗鱼、虎牙录播订阅
        <n-icon
          :size="24"
          style="vertical-align: middle; cursor: pointer"
          @click="showHelpModal = true"
        >
          <HelpCircleOutline />
        </n-icon>
      </h2>
      <div class="input">
        <n-input
          v-model:value="url"
          :style="{ width: '80%' }"
          placeholder="请输入视频链接或者直播间链接，比如：https://www.bilibili.com/video/BV1u94y1K7nr、https://v.douyu.com/show/brN0MmQqKl6MpyxA、https://www.huya.com/video/play/1043151558.html"
          @keyup.enter="download"
        />
        <n-button type="primary" ghost :disabled="!url" @click="download"> 下载 </n-button>
        <n-button
          type="info"
          ghost
          :disabled="!url || analysisSubmitting"
          :loading="analysisSubmitting"
          @click="analyzeDouyinVideo"
        >
          AI分析
        </n-button>
        <n-button type="primary" :disabled="!url" @click="subscribe"> 订阅 </n-button>
      </div>

      <div class="analysis-options">
        <div class="analysis-option-row">
          <span class="analysis-option-label">分析文档目录：</span>
          <n-input
            v-model:value="analysisOutputDir"
            placeholder="留空则保存到临时目录"
            :title="analysisOutputDir"
          />
          <n-button ghost @click="selectAnalysisOutputDir">选择目录</n-button>
        </div>
        <n-input
          v-model:value="analysisPrompt"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 8 }"
          placeholder="AI 分析提示词，留空则使用默认短视频分析提示词"
        />
      </div>

      <section v-if="analysisTask" class="analysis-panel">
        <div class="analysis-header">
          <div>
            <h3>{{ analysisOutput?.title || analysisTask.name || "抖音视频 AI 分析" }}</h3>
            <p v-if="analysisOutput?.sourceUrl" class="analysis-source">
              {{ analysisOutput.sourceUrl }}
            </p>
          </div>
          <div class="analysis-actions">
            <n-button
              size="small"
              type="primary"
              ghost
              :disabled="analysisTask.status !== 'completed'"
              :loading="analysisExporting"
              @click="exportAnalysis"
            >
              导出到文档
            </n-button>
            <n-button
              size="small"
              type="primary"
              :disabled="analysisTask.status !== 'completed'"
              :loading="analysisDownloading"
              @click="downloadAnalysisDocument"
            >
              下载文档
            </n-button>
          </div>
        </div>

        <n-progress
          v-if="['pending', 'running'].includes(analysisTask.status)"
          type="line"
          :percentage="analysisTask.progress"
          :indicator-placement="'outside'"
        />
        <p v-if="analysisTask.custsomProgressMsg" class="analysis-progress-text">
          {{ analysisTask.custsomProgressMsg }}
        </p>

        <n-alert v-if="analysisTask.status === 'error'" type="error" :bordered="false">
          {{ analysisTask.error || "AI 分析失败" }}
        </n-alert>

        <template v-if="analysisOutput">
          <n-alert
            v-if="analysisOutput.exportError"
            class="analysis-export-alert"
            type="warning"
            :bordered="false"
          >
            {{ analysisOutput.exportError }}
          </n-alert>

          <div v-if="analysisOutput.exportResults?.length" class="analysis-links">
            <span>文档链接：</span>
            <a
              v-for="result in analysisOutput.exportResults"
              :key="`${result.target}-${result.url}`"
              :href="result.url"
              target="_blank"
              rel="noreferrer"
            >
              {{ result.name }}
            </a>
          </div>

          <div v-if="analysisOutput.documentFile" class="analysis-local-doc">
            <span>本地文档：</span>
            <span :title="analysisOutput.documentFile">{{ analysisOutput.documentFile }}</span>
            <n-button v-if="!isWeb" size="tiny" ghost @click="openAnalysisDocumentFolder">
              打开目录
            </n-button>
          </div>

          <div class="analysis-summary">
            <h4>总结</h4>
            <pre>{{ analysisOutput.summary }}</pre>
          </div>

          <n-collapse>
            <n-collapse-item title="ASR 转写文本" name="transcript">
              <pre class="analysis-transcript">{{ analysisOutput.transcript }}</pre>
            </n-collapse-item>
          </n-collapse>
        </template>
      </section>

      <SubVideoList
        :list="subVideoList"
        @remove="getSuscribeList"
        @edit="handleEdit"
      ></SubVideoList>
      <DownloadConfirm
        v-model:visible="visible"
        v-model:select-ids="selectCids"
        :detail="data"
        :c-options="downloadOptions"
        @confirm="confirm"
      ></DownloadConfirm>
      <SubscribeModal
        v-model:visible="subscribeVisible"
        :data="subData"
        @update="getSuscribeList"
        @add="getSuscribeList"
      ></SubscribeModal>

      <!-- 帮助弹框 -->
      <n-modal v-model:show="showHelpModal">
        <n-card
          style="width: 600px"
          title="示例"
          :bordered="false"
          size="huge"
          role="dialog"
          aria-modal="true"
        >
          <template #header-extra>
            <n-button quaternary circle @click="showHelpModal = false">
              <n-icon size="24">
                <CloseOutline />
              </n-icon>
            </n-button>
          </template>

          <div class="help-content">
            <h3>下载</h3>
            <n-table :bordered="false" :single-line="false">
              <thead>
                <tr>
                  <th>平台</th>
                  <th>示例</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>B站视频</td>
                  <td>https://www.bilibili.com/video/BV1Hs421M755/</td>
                </tr>
                <tr>
                  <td>B站录播回放</td>
                  <td>https://live.bilibili.com/32736947</td>
                </tr>
                <tr>
                  <td>斗鱼录播</td>
                  <td>https://v.douyu.com/show/yVY8WwDpGmovLOz9</td>
                </tr>
                <tr>
                  <td>虎牙录播</td>
                  <td>https://www.huya.com/video/play/1062079466.html</td>
                </tr>
                <tr>
                  <td>快手录播</td>
                  <td>https://live.kuaishou.com/playback/3xfhg6rsxsbrddq</td>
                </tr>
                <tr>
                  <td>抖音录播</td>
                  <td>https://www.douyin.com/vsdetail/7553114817708594226</td>
                </tr>
              </tbody>
            </n-table>

            <h3 style="margin-top: 24px">订阅</h3>
            <n-table :bordered="false" :single-line="false">
              <thead>
                <tr>
                  <th>平台</th>
                  <th>示例</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>斗鱼录播</td>
                  <td>https://www.douyu.com/93589</td>
                </tr>
                <tr>
                  <td>虎牙录播</td>
                  <td>https://www.huya.com/910323</td>
                </tr>
              </tbody>
            </n-table>
          </div>
        </n-card>
      </n-modal>
    </n-spin>
  </div>
</template>

<script setup lang="ts">
defineOptions({
  name: "BiliDownload",
});
import { HelpCircleOutline, CloseOutline } from "@vicons/ionicons5";
import DownloadConfirm from "./components/DownloadModal.vue";
import SubscribeModal from "./components/SubscribeModal.vue";
import SubVideoList from "./components/SubVideoList.vue";
import { sanitizeFileName } from "@renderer/utils";
import { showDirectoryDialog } from "@renderer/utils/fileSystem";
import { taskApi } from "@renderer/apis";
import { videoApi } from "@renderer/apis";

import type { Task } from "@renderer/types";
import type { VideoAPI } from "@biliLive-tools/http/types/video.js";

type AnalysisOutput = {
  title: string;
  sourceUrl: string;
  summary: string;
  transcript: string;
  documentFile?: string;
  exportError?: string;
  exportResults?: Array<{
    target: string;
    name: string;
    url: string;
  }>;
};

const notice = useNotification();
const url = ref("");
const downloadOptions = ref({
  hasDanmuOptions: false,
  hasAudioOnlyOptions: false,
  hasDanmuOnlyOptions: false,
});

const selectCids = ref<(number | string)[]>([]);

const data = ref<VideoAPI["parseVideo"]["Resp"]>({
  platform: "bilibili",
  videoId: "",
  title: "",
  resolutions: [],
  parts: [],
});

const parse = async () => {
  const videoInfo = await taskApi.parseVideo(url.value);
  videoInfo.parts = videoInfo.parts.map((item) => {
    item.name = sanitizeFileName(item.name);
    return item;
  });
  data.value = videoInfo;
  selectCids.value = videoInfo.parts.map((item) => item.partId);

  if (videoInfo.platform === "bilibili") {
    downloadOptions.value = {
      hasDanmuOptions: true,
      hasAudioOnlyOptions: true,
      hasDanmuOnlyOptions: false,
    };
  } else if (videoInfo.platform === "douyu") {
    downloadOptions.value = {
      hasDanmuOptions: true,
      hasAudioOnlyOptions: false,
      hasDanmuOnlyOptions: true,
    };
  } else if (videoInfo.platform === "huya") {
    downloadOptions.value = {
      hasDanmuOptions: false,
      hasAudioOnlyOptions: false,
      hasDanmuOnlyOptions: false,
    };
  } else {
    downloadOptions.value = {
      hasDanmuOptions: false,
      hasAudioOnlyOptions: false,
      hasDanmuOnlyOptions: false,
    };
  }
};

const subData = ref<VideoAPI["SubList"]["Resp"][0]>({
  id: 0,
  platform: "douyu",
  enable: true,
  lastRunTime: 0,
  roomId: "",
  options: {
    quality: "highest",
    danma: false,
    sendWebhook: false,
  },
  name: "",
  subId: "",
});
const subscribeVisible = ref(false);
const subscribe = async () => {
  const res = await videoApi.subParse(url.value);
  subscribeVisible.value = true;
  subData.value = res;
};

const subVideoList = ref<VideoAPI["SubList"]["Resp"]>([]);
const getSuscribeList = async () => {
  const res = await videoApi.listSub();
  subVideoList.value = res;
};
getSuscribeList();

const download = async () => {
  if (!url.value) return;
  if (!url.value.trim()) {
    throw new Error("请输入视频链接");
  }
  loading.value = true;
  try {
    await parse();
    visible.value = true;
  } finally {
    loading.value = false;
  }
};

const confirm = async (options: {
  ids: (number | string)[];
  savePath: string;
  danmu: "none" | "xml";
  resoltion: string | "highest";
  override: boolean;
  onlyAudio: boolean;
  onlyDanmu: boolean;
}) => {
  const parts = data.value.parts.filter((item) => options.ids.includes(item.partId));
  const names = parts.map((item) => item.name);
  if (names.some((item) => !item)) {
    notice.error({
      title: "文件名不能为空",
      duration: 1000,
    });
    return;
  }
  if (new Set(names).size !== names.length) {
    notice.error({
      title: "文件名不能重复",
      duration: 3000,
    });
    return;
  }

  if (options.onlyDanmu && downloadOptions.value.hasDanmuOnlyOptions) {
    notice.info({
      title: `即将开始下载弹幕，请不要关闭此页面`,
      duration: 5000,
    });
  }

  for (const part of parts) {
    if (options.onlyDanmu && downloadOptions.value.hasDanmuOnlyOptions) {
      notice.info({
        title: `已开始下载弹幕：${part.name}`,
        duration: 5000,
      });
    }

    await taskApi.downloadVideo({
      id: part.partId,
      platform: data.value.platform,
      savePath: options.savePath,
      filename: `${sanitizeFileName(part.name)}.ts`,
      resolution: options.resoltion,
      extra: part.extra,
      danmu: options.danmu,
      override: options.override,
      onlyAudio: options.onlyAudio,
      onlyDanmu: options.onlyDanmu,
    });

    if (options.onlyDanmu && downloadOptions.value.hasDanmuOnlyOptions) {
      notice.info({
        title: `已结束下载弹幕：${part.name}`,
        duration: 5000,
      });
    }
  }
  if (!options.onlyDanmu && downloadOptions.value.hasDanmuOnlyOptions) {
    notice.success({
      title: "已加入队列",
      duration: 2000,
    });
  }

  visible.value = false;
};

const visible = ref(false);
const loading = ref(false);
const analysisSubmitting = ref(false);
const analysisExporting = ref(false);
const analysisDownloading = ref(false);
const analysisTask = ref<Task | null>(null);
const analysisOutputDir = ref("");
const analysisPrompt = ref("");
let analysisTimer: number | null = null;
const ANALYSIS_OUTPUT_DIR_STORAGE_KEY = "douyin-video-analysis-output-dir";
const ANALYSIS_PROMPT_STORAGE_KEY = "douyin-video-analysis-prompt";
const isWeb = window.isWeb;

const analysisOutput = computed(() => analysisTask.value?.output as AnalysisOutput | undefined);

onMounted(() => {
  analysisOutputDir.value = localStorage.getItem(ANALYSIS_OUTPUT_DIR_STORAGE_KEY) || "";
  analysisPrompt.value = localStorage.getItem(ANALYSIS_PROMPT_STORAGE_KEY) || "";
});

watch(analysisOutputDir, (value) => {
  localStorage.setItem(ANALYSIS_OUTPUT_DIR_STORAGE_KEY, value);
});

watch(analysisPrompt, (value) => {
  localStorage.setItem(ANALYSIS_PROMPT_STORAGE_KEY, value);
});

const stopAnalysisPolling = () => {
  if (!analysisTimer) return;
  window.clearInterval(analysisTimer);
  analysisTimer = null;
};

const refreshAnalysisTask = async (taskId: string) => {
  const task = await taskApi.get(taskId);
  analysisTask.value = task;
  if (["completed", "error", "canceled"].includes(task.status)) {
    stopAnalysisPolling();
  }
};

const startAnalysisPolling = (taskId: string) => {
  stopAnalysisPolling();
  analysisTimer = window.setInterval(() => {
    refreshAnalysisTask(taskId).catch((error) => {
      stopAnalysisPolling();
      notice.error({
        title: "刷新 AI 分析状态失败",
        content: error?.message || String(error),
        duration: 3000,
      });
    });
  }, 1500);
};

const analyzeDouyinVideo = async () => {
  const targetUrl = url.value.trim();
  if (!targetUrl) return;

  analysisSubmitting.value = true;
  try {
    const res = await taskApi.analyzeDouyinVideo({
      url: targetUrl,
      outputDir: analysisOutputDir.value.trim() || undefined,
      prompt: analysisPrompt.value.trim() || undefined,
    });
    await refreshAnalysisTask(res.taskId);
    startAnalysisPolling(res.taskId);
    notice.success({
      title: "已开始 AI 分析",
      duration: 2000,
    });
  } finally {
    analysisSubmitting.value = false;
  }
};

const selectAnalysisOutputDir = async () => {
  const dir = await showDirectoryDialog({
    defaultPath: analysisOutputDir.value,
  });
  if (!dir) return;
  analysisOutputDir.value = dir;
};

const exportAnalysis = async () => {
  if (!analysisTask.value) return;

  analysisExporting.value = true;
  try {
    const res = await taskApi.exportDouyinVideoAnalysis(analysisTask.value.taskId);
    analysisTask.value = {
      ...analysisTask.value,
      output: res.output,
    };
    notice.success({
      title: "已导出到文档",
      duration: 2000,
    });
  } finally {
    analysisExporting.value = false;
  }
};

const downloadAnalysisDocument = async () => {
  if (!analysisTask.value) return;

  analysisDownloading.value = true;
  try {
    const res = await taskApi.downloadDouyinVideoAnalysisDocument(analysisTask.value.taskId);
    window.open(res.url, "_blank");
  } finally {
    analysisDownloading.value = false;
  }
};

const openAnalysisDocumentFolder = async () => {
  const documentFile = analysisOutput.value?.documentFile;
  if (!documentFile || window.isWeb) return;
  await window.api.openPath(window.path.dirname(documentFile));
};

onUnmounted(() => {
  stopAnalysisPolling();
});

const handleEdit = (item: VideoAPI["SubList"]["Resp"][0]) => {
  subscribeVisible.value = true;
  subData.value = {
    id: item.id,
    platform: item.platform,
    options: item.options,
    name: item.name,
    subId: item.id.toString(),
    enable: item.enable,
    lastRunTime: item.lastRunTime,
    roomId: item.roomId,
  };
};

const showHelpModal = ref(false);
</script>

<style scoped lang="less">
.container {
  // display: flex;
  // justify-content: center;
  // flex-direction: column;
  // align-items: center;
  width: 80%;
  margin: 0 auto;
  margin-top: 60px;
}
.input {
  display: flex;
  align-items: center;
  gap: 8px;
}

.analysis-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}

.analysis-option-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.analysis-option-label {
  flex: none;
  color: #555;
  font-size: 13px;
}

.analysis-panel {
  margin-top: 18px;
  padding: 16px 0;
  border-top: 1px solid #e5e7eb;
  border-bottom: 1px solid #e5e7eb;
}

.analysis-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 12px;

  h3 {
    margin: 0 0 6px;
    font-size: 18px;
    line-height: 1.4;
  }
}

.analysis-source {
  margin: 0;
  color: #666;
  font-size: 12px;
  word-break: break-all;
}

.analysis-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}

.analysis-progress-text {
  margin: 8px 0 0;
  color: #666;
}

.analysis-export-alert {
  margin: 12px 0;
}

.analysis-links {
  display: flex;
  gap: 10px;
  align-items: center;
  margin: 12px 0;

  a {
    color: #18a058;
    text-decoration: none;
  }
}

.analysis-local-doc {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 12px 0;
  color: #555;
  font-size: 12px;

  span:nth-child(2) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.analysis-summary {
  margin-top: 12px;

  h4 {
    margin: 0 0 8px;
  }
}

.analysis-summary pre,
.analysis-transcript {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
  font-family: inherit;
}

@media (max-width: 720px) {
  .input,
  .analysis-option-row {
    align-items: stretch;
    flex-direction: column;
  }

  .analysis-option-label {
    align-self: flex-start;
  }
}

.help-content {
  h3 {
    color: #18a058;
    font-weight: 600;
    margin-bottom: 12px;
  }

  :deep(.n-table) {
    th {
      background-color: #f8f9fa;
      font-weight: 600;
    }

    td {
      border-bottom: 1px solid #e5e7eb;
    }

    tr:hover {
      background-color: #f8f9fa;
    }
  }
}
</style>
