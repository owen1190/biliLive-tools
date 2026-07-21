import videoSub from "@biliLive-tools/shared/video/videoSub.js";
import type {
  DouyinVideoAnalysisOutput,
  DouyinVideoAnalysisTask,
} from "@biliLive-tools/shared/task/douyinVideoAnalysis.js";

type Platform = "douyu" | "bilibili" | "huya" | "bilibiliLive" | "kuaishou" | "douyinLive";

export type VideoAPI = {
  parseVideo: {
    Args: { url: string };
    Resp: {
      platform: Platform;
      videoId: string;
      title: string;
      resolutions: { label: string; value: string }[];
      parts: { name: string; partId: string; isEditing: boolean; extra?: Record<string, any> }[];
      extra?: Record<string, any>;
    };
  };
  downloadVideo: {
    Args: {
      id: string;
      platform: Platform;
      savePath: string;
      filename: string;
      resolution?: string;
      extra?: Record<string, any>;
      danmu: "none" | "xml";
      override: boolean;
      onlyAudio?: boolean;
      onlyDanmu?: boolean;
    };
  };
  analyzeDouyinVideo: {
    Args: {
      url: string;
      prompt?: string;
      outputDir?: string;
    };
    Resp: {
      taskId: string;
    };
  };
  exportDouyinVideoAnalysis: {
    Args: {
      taskId: string;
      exportTargets?: {
        feishu?: {
          enabled: boolean;
          mode?: "append" | "create";
          documentId?: string;
          folderToken?: string;
          titleTemplate?: string;
        };
        notion?: {
          enabled: boolean;
          mode?: "append" | "create_child_page";
          pageId?: string;
          titleTemplate?: string;
        };
        yuque?: {
          enabled: boolean;
          mode?: "append" | "create";
          namespace?: string;
          slug?: string;
          baseUrl?: string;
          titleTemplate?: string;
        };
      };
    };
    Resp: {
      results: DouyinVideoAnalysisOutput["exportResults"];
      output: DouyinVideoAnalysisOutput;
    };
  };
  downloadDouyinVideoAnalysisDocument: {
    Args: {
      taskId: string;
    };
    Resp: {
      fileId: string;
      url: string;
    };
  };
  DouyinVideoAnalysisTask: DouyinVideoAnalysisTask;
  SubList: {
    Args: {};
    Resp: ReturnType<(typeof videoSub)["list"]>;
  };
  SubAdd: {
    Args: Parameters<(typeof videoSub)["add"]>[0];
    Resp: number;
  };
  SubRemove: {
    Args: { id: number };
    Resp: number;
  };
  SubUpdate: {
    Args: Parameters<(typeof videoSub)["update"]>[0];
    Resp: number;
  };
  SubParse: {
    Args: { url: string };
    Resp: Parameters<(typeof videoSub)["add"]>[0];
  };
};
