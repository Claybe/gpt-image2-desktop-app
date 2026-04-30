# Generate Image Skill 使用文档 / User Guide

## 中文

### 简介

`generate-image` 是一个 Claude Code skill，用于通过兼容 OpenAI Images API 的接口生成图片。它支持初始化 URL/API Key，支持提示词和参数输入，并在实际生成前创建同分辨率占位图。

### 命令

- `/generate-image:initialize`：设置 API URL、API Key、默认模型。
- `/generate-image`：输入提示词和参数，生成图片。

### 初始化示例

```text
/generate-image:initialize url=https://api.example.com/v1 apikey=sk-xxx model=gpt-image-2
```

内部执行：

```bash
node skill/generate-image/scripts/generate-image.mjs initialize --url https://api.example.com/v1 --apikey sk-xxx --model gpt-image-2
```

### 生成示例

```text
/generate-image 一张赛博朋克风格的上海夜景，尺寸 1536x1024，quality=high
```

内部执行示例：

```bash
node skill/generate-image/scripts/generate-image.mjs generate \
  --prompt "一张赛博朋克风格的上海夜景" \
  --size 1536x1024 \
  --param quality=high
```

### 参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| prompt | 是 | 图片提示词 |
| size | 否 | `1024x1024`、`1024x1536`、`1536x1024`、`auto` |
| model | 否 | 默认 `gpt-image-2` |
| url | 否 | 覆盖初始化 URL |
| apikey | 否 | 覆盖初始化 API Key |
| output | 否 | 输出目录 |
| param | 否 | 任意透传参数，格式 `key=value` |

### 输出

默认输出目录是当前目录下的 `generated-images/`。

每次生成包含：

1. 占位图：生成请求发出前创建，尺寸与目标图片一致。
2. 生成图片：API 成功返回后保存。

### 错误处理

生成失败时会输出明确错误，例如：

- API Key 缺失
- URL 缺失
- 接口返回 HTTP 错误
- 响应中没有图片数据
- URL 图片下载失败

占位图会保留，方便 UI 或流程继续展示生成状态。

## English

### Introduction

`generate-image` is a Claude Code skill for generating images through an OpenAI Images API-compatible endpoint. It supports URL/API key initialization, prompt and parameter input, and creates a same-resolution placeholder before the real image generation request.

### Commands

- `/generate-image:initialize`: configure API URL, API key, and default model.
- `/generate-image`: generate an image from a prompt and parameters.

### Initialize example

```text
/generate-image:initialize url=https://api.example.com/v1 apikey=sk-xxx model=gpt-image-2
```

Internal command:

```bash
node skill/generate-image/scripts/generate-image.mjs initialize --url https://api.example.com/v1 --apikey sk-xxx --model gpt-image-2
```

### Generate example

```text
/generate-image a cyberpunk night view of Shanghai, size 1536x1024, quality=high
```

Internal command example:

```bash
node skill/generate-image/scripts/generate-image.mjs generate \
  --prompt "a cyberpunk night view of Shanghai" \
  --size 1536x1024 \
  --param quality=high
```

### Parameters

| Parameter | Required | Description |
| --- | --- | --- |
| prompt | Yes | Image prompt |
| size | No | `1024x1024`, `1024x1536`, `1536x1024`, or `auto` |
| model | No | Defaults to `gpt-image-2` |
| url | No | Overrides initialized URL |
| apikey | No | Overrides initialized API key |
| output | No | Output directory |
| param | No | Passthrough parameter in `key=value` format |

### Output

The default output directory is `generated-images/` under the current directory.

Each generation includes:

1. Placeholder image: created before the API request, with the same target resolution.
2. Generated image: saved after the API returns successfully.

### Error handling

On failure, the skill reports clear errors such as:

- Missing API key
- Missing URL
- HTTP error from the API
- No image data in the response
- Failed download from returned image URL

The placeholder remains available so the UI or workflow can keep showing the generation state.
