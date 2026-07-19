<!-- 文件同步 -->
<template>
  <div>
    <div class="flex justify-center align-center" style="margin-bottom: 20px; gap: 10px">
      <span style="cursor: pointer; color: #958e8e" @click="clear">清空</span>
      <n-button @click="addFiles"> 添加 </n-button>
      <n-button type="primary" @click="sync" title="立即同步(ctrl+enter)"> 立即上传 </n-button>
    </div>

    <FileSelect ref="fileSelect" v-model="fileList" :sort="false" :extensions="['*']"></FileSelect>

    <div class="flex align-center" style="margin-top: 10px; gap: 10px; justify-content: center">
      <n-select
        v-model:value="options.syncType"
        :options="syncConfigOptions"
        placeholder="选择同步网盘"
        style="width: 140px; display: inline-block"
      />
      <n-select
        v-if="options.syncType === 'aliyunpan'"
        v-model:value="options.aliyunpanDriveType"
        :options="aliyunpanDriveOptions"
        placeholder="选择上传位置"
        style="width: 140px; display: inline-block"
      />
      <n-input
        v-model:value="options.targetPath"
        placeholder="请输入目标路径"
        style="width: 200px"
      />
      <n-select
        v-model:value="selectedFavoritePathId"
        :options="favoritePathOptions"
        clearable
        placeholder="常用目标地址"
        style="width: 160px"
        @update:value="applyFavoritePath"
      />
      <n-button secondary @click="saveCurrentTargetPathAsFavorite">保存为常用</n-button>
      <n-checkbox v-model:checked="options.removeOrigin"> 完成后移除源文件 </n-checkbox>
    </div>

    <div v-if="favoritePaths.length" class="favorite-paths">
      <n-tag
        v-for="item in favoritePaths"
        :key="item.id"
        closable
        @click="options.targetPath = item.path"
        @close.stop="removeFavoritePath(item.id)"
      >
        {{ item.name }}
      </n-tag>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({
  name: "FileSync",
});

import { toReactive } from "@vueuse/core";
import FileSelect from "@renderer/pages/Tools/pages/FileUpload/components/FileSelect.vue";

import { useAppConfig } from "@renderer/stores";
import { syncApi } from "@renderer/apis";
import { uuid } from "@renderer/utils";
import hotkeys from "hotkeys-js";

import type { AliyunPanDriveType } from "@biliLive-tools/types";

const notice = useNotification();
const { appConfig } = storeToRefs(useAppConfig());

const options = toReactive(
  computed({
    get: () => appConfig.value.tool.fileSync,
    set: (value) => {
      appConfig.value.tool.fileSync = value;
    },
  }),
);

const fileList = ref<{ id: string; title: string; path: string; visible: boolean }[]>([]);
const selectedFavoritePathId = ref<string | null>(null);
const favoritePaths = computed({
  get: () => options.favoritePaths || [],
  set: (value) => {
    options.favoritePaths = value;
  },
});
const favoritePathOptions = computed(() =>
  favoritePaths.value.map((item) => ({
    label: item.name,
    value: item.id,
  })),
);

onActivated(() => {
  hotkeys("ctrl+enter", function () {
    sync();
  });
});
onDeactivated(() => {
  hotkeys.unbind();
});
onUnmounted(() => {
  hotkeys.unbind();
});

const syncConfigOptions = computed(() => {
  return [
    {
      label: "百度网盘",
      value: "baiduPCS",
    },
    {
      label: "阿里云盘",
      value: "aliyunpan",
    },
    {
      label: "alist",
      value: "alist",
    },
    {
      label: "123网盘",
      value: "pan123",
    },
    // {
    //   label: "本地复制",
    //   value: "copy",
    // },
  ];
});

const aliyunpanDriveOptions: Array<{ label: string; value: AliyunPanDriveType }> = [
  {
    label: "备份盘",
    value: "backup",
  },
  {
    label: "资源库",
    value: "resource",
  },
];

const sync = async () => {
  if (!options.syncType) {
    notice.error({
      title: `请选择同步网盘`,
      duration: 1000,
    });
    return;
  }

  if (fileList.value.length === 0) {
    notice.error({
      title: `至少选择一个文件`,
      duration: 1000,
    });
    return;
  }

  notice.info({
    title: `开始上传`,
    duration: 1000,
  });

  for (const file of fileList.value) {
    await syncApi.sync({
      file: file.path,
      type: options.syncType,
      targetPath: options.targetPath,
      aliyunpanDriveType:
        options.syncType === "aliyunpan" ? options.aliyunpanDriveType || "backup" : undefined,
      options: {
        removeOrigin: options.removeOrigin,
      },
    });
  }

  fileList.value = [];
};

const clear = () => {
  fileList.value = [];
};

const applyFavoritePath = (id: string | null) => {
  if (!id) return;
  const favorite = favoritePaths.value.find((item) => item.id === id);
  if (!favorite) return;
  options.targetPath = favorite.path;
};

const saveCurrentTargetPathAsFavorite = () => {
  const targetPath = options.targetPath?.trim();
  if (!targetPath) {
    notice.error({
      title: "请先输入目标路径",
      duration: 1000,
    });
    return;
  }

  const exists = favoritePaths.value.some((item) => item.path === targetPath);
  if (exists) {
    notice.info({
      title: "该地址已在常用列表中",
      duration: 1000,
    });
    return;
  }

  favoritePaths.value = [
    ...favoritePaths.value,
    {
      id: uuid(),
      name: targetPath,
      path: targetPath,
    },
  ];
  notice.success({
    title: "已保存为常用地址",
    duration: 1000,
  });
};

const removeFavoritePath = (id: string) => {
  favoritePaths.value = favoritePaths.value.filter((item) => item.id !== id);
  if (selectedFavoritePathId.value === id) {
    selectedFavoritePathId.value = null;
  }
};

const fileSelect = ref<InstanceType<typeof FileSelect> | null>(null);
const addFiles = async () => {
  fileSelect.value?.select();
};
</script>

<style scoped lang="less">
.favorite-paths {
  display: flex;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;

  :deep(.n-tag) {
    cursor: pointer;
  }
}
</style>
