# 通义千问 LLM 使用文档

## 概述

本模块提供了基于 OpenAI 兼容 SDK 调用阿里云通义千问 API 的封装。

## 安装依赖

```bash
pnpm install openai
```

## 快速开始

### 1. 基本使用

```typescript
import { QwenLLM } from "@biliLive-tools/shared";

const llm = new QwenLLM({
  apiKey: "sk-your-api-key-here", // 你的阿里云 API Key
  model: "qwen-plus", // 可选，默认 qwen-plus
});

// 发送单条消息
const response = await llm.sendMessage(
  "你好，请介绍一下自己",
  "你是一个有帮助的助手", // 可选的系统提示
);

console.log(response.content);
```

### 2. 多轮对话

```typescript
const response = await llm.chat([
  { role: "system", content: "你是一个专业的编程助手" },
  { role: "user", content: "什么是 TypeScript？" },
  { role: "assistant", content: "TypeScript 是 JavaScript 的超集..." },
  { role: "user", content: "它有什么优点？" },
]);
```

### 3. 流式输出

```typescript
const stream = await llm.chat([{ role: "user", content: "写一首诗" }], {
  stream: true,
  temperature: 0.8,
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content || "";
  process.stdout.write(content);
}
```

## 配置选项

### QwenConfig

| 参数    | 类型   | 必填 | 默认值                                            | 说明                  |
| ------- | ------ | ---- | ------------------------------------------------- | --------------------- |
| apiKey  | string | 是   | -                                                 | API Key，格式：sk-xxx |
| model   | string | 否   | qwen-plus                                         | 模型名称              |
| baseURL | string | 否   | https://dashscope.aliyuncs.com/compatible-mode/v1 | API 端点              |
| timeout | number | 否   | 60000                                             | 超时时间（毫秒）      |

### 可用模型

- `qwen-turbo` - 快速模型，适合日常对话
- `qwen-plus` - 平衡性能和成本
- `qwen-max` - 最强大的模型
- `qwen-max-longcontext` - 支持长上下文
- `qwen-vl` - 多模态模型（支持图像）
- 更多模型请参考：https://help.aliyun.com/zh/model-studio/getting-started/models

### ChatOptions

| 参数            | 类型               | 默认值     | 说明                                      |
| --------------- | ------------------ | ---------- | ----------------------------------------- |
| temperature     | number             | 0.7        | 采样温度，控制随机性 [0, 2)               |
| topP            | number             | -          | 核采样概率阈值 (0, 1.0]                   |
| maxTokens       | number             | -          | 最大输出 token 数                         |
| stream          | boolean            | false      | 是否流式输出                              |
| stop            | string \| string[] | -          | 停止词                                    |
| presencePenalty | number             | -          | 内容重复度 [-2.0, 2.0]                    |
| enableSearch    | boolean            | false      | 是否开启联网搜索                          |
| enableThinking  | boolean            | 供应商默认 | 是否开启思考（阿里云、DeepSeek 官方端点） |
| extraBody       | object             | -          | 供应商特有的高级请求参数                  |

### 通用模型配置

在 AI 设置的“编辑模型”中，为 LLM 配置最大输出 tokens、思考模式和高级请求参数。配置保存在 `model.config.llm`，直播总结、抖音分析、歌曲识别、歌词优化统一读取；不再设置任务或供应商专属的固定输出额度。

```typescript
model.config.llm = {
  maxTokens: 16000,
  enableThinking: false,
};
```

最大输出 tokens 留空时，不发送 `max_tokens`，使用供应商默认额度；填写后严格使用该正整数，不会自动提高或降低。思考模型的额度通常同时覆盖推理与最终正文，应按模型需要预留空间。旧配置无需迁移，未配置的字段继续使用供应商默认值。

思考模式“供应商默认”不发送开关；DeepSeek 官方端点自动使用 `thinking: { type: "enabled/disabled" }`，通义默认接口及已识别的通义兼容端点使用 `enable_thinking`。未知接口不会猜测参数：请选择“供应商默认”，通过高级参数填写接口支持的开关或思考强度。

例如，其他兼容接口支持 `reasoning_effort` 和 `max_completion_tokens` 时，可留空最大输出 tokens，在高级请求参数中填写：

```json
{
  "reasoning_effort": "low",
  "max_completion_tokens": 16000
}
```

高级参数必须是 JSON 对象，会覆盖普通生成参数，但不能覆盖 `model`、`messages`、`stream`、凭证或基础地址字段。最大输出 tokens、`max_tokens`、`max_completion_tokens` 只能选一种，重复配置会在保存或发起请求前报错。

直接使用 `OpenAICompatibleLLM` 时，可将相同配置传入构造参数的 `modelConfig`；单次调用的 `maxTokens`、`enableThinking` 优先于模型默认值，高级参数按字段合并并最终覆盖普通参数。

非流式请求遇到 `finish_reason: "length"` 或空正文时会抛出明确错误，避免把截断结果作为完整总结。日志仅记录推理长度和 token 数，不记录推理正文。

## 高级功能

### 控制输出长度

```typescript
const response = await llm.sendMessage("介绍一下北京", undefined, {
  maxTokens: 100, // 限制在 100 个 token 以内
});
```

### 调整创造性

```typescript
// 创意写作 - 高温度
const creative = await llm.sendMessage("写一个故事", undefined, {
  temperature: 0.9,
});

// 事实性回答 - 低温度
const factual = await llm.sendMessage("什么是 DNA？", undefined, {
  temperature: 0.1,
});
```

### 降低重复度

```typescript
const response = await llm.sendMessage("写一段产品介绍", undefined, {
  presencePenalty: 1.0, // 降低重复
});
```

### 联网搜索

```typescript
const response = await llm.sendMessage("2024年最新的 AI 技术发展如何？", undefined, {
  enableSearch: true, // 启用联网搜索获取最新信息
});
```

### 停止词

```typescript
const response = await llm.sendMessage("列举编程语言", undefined, {
  stop: ["\n\n", "###"], // 遇到这些词就停止生成
});
```

## 完整示例

查看 `task/llm-example.ts` 获取更多完整示例：

```bash
tsx packages/shared/src/task/llm-example.ts
```

## API Key 获取

1. 访问阿里云百炼平台：https://www.aliyun.com/product/bailian
2. 登录后进入控制台
3. 创建 API Key
4. 配置环境变量或直接传入代码

## 参考文档

- [阿里云通义千问 API 参考](https://help.aliyun.com/zh/model-studio/qwen-api-reference)
- [OpenAI SDK 文档](https://platform.openai.com/docs/api-reference)

## 注意事项

1. API Key 安全：不要将 API Key 提交到代码仓库
2. 费用控制：注意使用量，避免超出预算
3. 速率限制：注意 API 的调用频率限制
4. 错误处理：生产环境中请添加适当的错误处理和重试逻辑
