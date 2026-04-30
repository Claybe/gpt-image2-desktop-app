# Generate Image Skill 使用文档 / User Guide

## 中文

### 简介

`generate-image` 是一个 Claude Code skill，用于通过兼容 OpenAI Images API 的接口生成图片。它支持通过 `/gi-setup` 分步初始化 URL/API Key，或直接使用项目 `setting.json` 里的 URL 和 Key；支持提示词、参数和输出位置输入。生成流程简化为：输入 prompt → 生成同分辨率占位图 → 后台运行名为 `painter` 的 subagent → 拿到最终结果后替换占位图。

### 命令

- `/gi-setup`：分步设置 API URL、API Key，默认模型为 `gpt-image2`；也可选择直接读取项目 `setting.json`。
- `/gi`：输入提示词和参数，生成图片。

### npx skills 安装

全局安装到 Claude Code：

```bash
npx --yes skills add Claybe/gpt-image2-desktop-app --skill generate-image --agent claude-code --global --copy --yes
```

安装到当前项目：

```bash
npx --yes skills add Claybe/gpt-image2-desktop-app --skill generate-image --agent claude-code --copy --yes
```

安装后重启 Claude Code 或开启新会话。

### setup 示例

```text
/gi-setup url=https://api.example.com/v1 apikey=sk-xxx model=gpt-image2
```

内部执行：

```bash
node skill/generate-image/scripts/generate-image.mjs setup --url https://api.example.com/v1 --apikey sk-xxx --model gpt-image2
```

### gi-setup 使用 setting.json

如果项目根目录有 `setting.json`，并包含 `apiBaseUrl` / `apiKey`（也支持 `url` / `apikey`），可以直接选择使用：

```text
/gi-setup --use-settings
```

内部执行：

```bash
node skill/generate-image/scripts/generate-image.mjs setup --use-settings
```

也可以指定路径：

```bash
node skill/generate-image/scripts/generate-image.mjs setup --use-settings --settings ./setting.json
```

### 未初始化时的引导

如果直接使用 `/gi`，但尚未配置 URL 或 API Key，skill 会自动进入 `/gi-setup` 初始化流程，并一步一步引导你提供：

1. 请输入你的 URL（API Base URL）
2. 请输入你的 Key（API Key）
3. 默认模型为 `gpt-image2`，如需覆盖可提供其他 model
4. 也可以选择直接使用项目 `setting.json` 里的 URL 和 Key

```text
/gi-setup url=<你的 API Base URL> apikey=<你的 API Key> model=gpt-image2
/gi-setup --use-settings
```

不会只返回一个模糊失败错误。

### 生成示例

```text
/gi 一张赛博朋克风格的上海夜景，尺寸 1536x1024，quality=high output-file=./.claybe/.generate-image/shanghai.png
```

内部执行示例：

```bash
node skill/generate-image/scripts/generate-image.mjs generate \
  --prompt "一张赛博朋克风格的上海夜景" \
  --size 1536x1024 \
  --output-file ./.claybe/.generate-image/shanghai.png \
  --param quality=high
```

### 参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| prompt | 是 | 图片提示词 |
| size | 否 | `1024x1024`、`1024x1536`、`1536x1024`、`auto` |
| model | 否 | 默认 `gpt-image2` |
| url | 否 | 覆盖初始化 URL |
| apikey | 否 | 覆盖初始化 API Key |
| output | 否 | 输出目录；如果值以 `.png`、`.jpg`、`.jpeg`、`.webp` 结尾，则视为最终图片文件路径 |
| output-file | 否 | 最终图片文件路径 |
| index | 否 | 图片索引字典文件路径；默认 `<输出目录>/image-index.json` |
| param | 否 | 任意透传参数，格式 `key=value` |

### 输出

默认输出目录是项目目录下的 `.claybe/.generate-image/`。也可以使用 `output-file` 指定最终图片文件路径，或把带图片扩展名的路径传给 `output`。每次生成会维护一个索引字典文件，默认路径为 `<输出目录>/image-index.json`，用于按图片路径查询对应提示词和生成结果。

每次生成包含：

1. 占位图：生成请求发出前创建，尺寸与目标图片一致。
2. 后台任务：名为 `painter` 的 subagent 执行实际生成。
3. 生成图片：API 成功返回后保存，并作为最终结果替换占位图。

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

`generate-image` is a Claude Code skill for generating images through an OpenAI Images API-compatible endpoint. It supports step-by-step URL/API key setup through `/gi-setup`, or directly using URL and Key from the project `setting.json`; prompt, parameter, and output-location input. The generation flow is simplified to: input prompt → create a same-resolution placeholder → run a background subagent named `painter` → replace the placeholder with the final result.

### Commands

- `/gi-setup`: configure API URL and API key step by step; the default model is `gpt-image2`; can also read the project `setting.json`.
- `/gi`: generate an image from a prompt and parameters.

### Install with npx skills

Global install for Claude Code:

```bash
npx --yes skills add Claybe/gpt-image2-desktop-app --skill generate-image --agent claude-code --global --copy --yes
```

Project-local install:

```bash
npx --yes skills add Claybe/gpt-image2-desktop-app --skill generate-image --agent claude-code --copy --yes
```

Restart Claude Code or open a new session after installation.

### Setup example

```text
/gi-setup url=https://api.example.com/v1 apikey=sk-xxx model=gpt-image2
```

Internal command:

```bash
node skill/generate-image/scripts/generate-image.mjs setup --url https://api.example.com/v1 --apikey sk-xxx --model gpt-image2
```

### Use setting.json with gi-setup

If the project root has `setting.json` with `apiBaseUrl` / `apiKey` (also supports `url` / `apikey`), choose direct setup:

```text
/gi-setup --use-settings
```

Internal command:

```bash
node skill/generate-image/scripts/generate-image.mjs setup --use-settings
```

You can also specify the settings path:

```bash
node skill/generate-image/scripts/generate-image.mjs setup --use-settings --settings ./setting.json
```

### Setup guidance when not set up

If `/gi` is used before URL or API key configuration exists, the skill automatically enters the `/gi-setup` setup flow and guides the user step by step to provide:

1. Please enter your URL (API Base URL)
2. Please enter your Key (API Key)
3. The default model is `gpt-image2`; provide another model only if needed
4. Or choose to use URL and Key directly from the project `setting.json`

```text
/gi-setup url=<your API Base URL> apikey=<your API Key> model=gpt-image2
/gi-setup --use-settings
```

It does not only return a vague failure.

### Generate example

```text
/gi a cyberpunk night view of Shanghai, size 1536x1024, quality=high output-file=./.claybe/.generate-image/shanghai.png
```

Internal command example:

```bash
node skill/generate-image/scripts/generate-image.mjs generate \
  --prompt "a cyberpunk night view of Shanghai" \
  --size 1536x1024 \
  --output-file ./.claybe/.generate-image/shanghai.png \
  --param quality=high
```

### Parameters

| Parameter | Required | Description |
| --- | --- | --- |
| prompt | Yes | Image prompt |
| size | No | `1024x1024`, `1024x1536`, `1536x1024`, or `auto` |
| model | No | Defaults to `gpt-image2` |
| url | No | Overrides configured URL |
| apikey | No | Overrides configured API key |
| output | No | Output directory; if the value ends with `.png`, `.jpg`, `.jpeg`, or `.webp`, it is treated as the final image file path |
| output-file | No | Final image file path |
| index | No | Image index dictionary file path; defaults to `<output directory>/image-index.json` |
| param | No | Passthrough parameter in `key=value` format |

### Output

The default output directory is `.claybe/.generate-image/` under the project directory. You can also use `output-file` for the final image file path, or pass an image-extension path to `output`. Each generation maintains an index dictionary file, defaulting to `<output directory>/image-index.json`, for looking up prompts and generation results by image path.

Each generation includes:

1. Placeholder image: created before the API request, with the same target resolution.
2. Background task: the `painter` subagent performs the actual generation.
3. Generated image: saved after the API returns successfully and used as the final replacement for the placeholder.

### Error handling

On failure, the skill reports clear errors such as:

- Missing API key
- Missing URL
- HTTP error from the API
- No image data in the response
- Failed download from returned image URL

The placeholder remains available so the UI or workflow can keep showing the generation state.
