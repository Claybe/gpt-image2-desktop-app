---
name: generate-image
description: Use when the user wants Claude Code to generate images from prompts, use /gi or /gi-setup, configure an OpenAI Images API-compatible endpoint, create placeholder images, delegate generation to a background subagent named painter, pass model parameters, choose output paths, or maintain an image index. If generation is requested before setup, guide the user through /gi-setup instead of failing.
argument-hint: "/gi-setup | <prompt> [--size auto] [--model gpt-image-2] [--output <dir>|--output-file <path>] [--param key=value]"
---

# Generate Image Skill

## 中文说明

### 功能概述

`generate-image` 用于通过兼容 OpenAI Images API 的接口生成图片。用户主要使用 `/gi-setup` 初始化配置，使用 `/gi` 输入 prompt 和参数生成图片。

默认行为：

- 默认模型：`gpt-image-2`（兼容旧配置里的 `gpt-image2` / `auto`，helper 会映射为 `gpt-image-2`）
- 默认尺寸：`auto`（占位图按 `1024x1024` 创建）
- 默认输出目录：项目目录下 `.claybe/.generate-image/`
- 默认配置文件：`~/.claude/generate-image/config.json`

### Slash 命令

#### `/gi-setup`

用于保存 API 配置。按步骤引导用户提供：

1. URL（API Base URL）
2. API Key
3. 是否使用默认模型 `gpt-image-2`

如果用户已提供部分参数，只追问缺失项。也支持直接读取项目 `setting.json`：

```text
/gi-setup --use-settings
```

对应 helper：

```bash
node skill/generate-image/scripts/generate-image.mjs setup --use-settings
```

或：

```bash
node skill/generate-image/scripts/generate-image.mjs setup --url <url> --apikey <apikey> --model gpt-image-2
```

`setting.json` 可使用顶层字段 `apiBaseUrl` / `apiKey` / `model`，也支持 `url` / `apikey`，以及嵌套在 `generateImage` 或 `generate-image` 下。

#### `/gi`

用于生成图片。支持 CLI 风格参数，也支持从自然语言中提取参数：

```text
/gi 一张赛博朋克风格的上海夜景，尺寸 1536x1024，quality=high output-file=./.claybe/.generate-image/shanghai.png
```

当配置缺失时，不要只报错；进入 `/gi-setup` 引导用户配置 URL/API Key，或询问是否使用项目 `setting.json`。

### Agent 执行规则

1. 从 `/gi` 输入中提取：
   - `prompt`
   - `size`
   - `model`
   - `output`
   - `output-file`
   - `index`
   - `url` / `apikey`
   - 其他 `key=value` 参数，作为 `--param key=value` 透传
2. 如果未指定 `size`，使用 `auto`。
3. 如果未指定 `model`，使用 `gpt-image-2`。
4. 组织 prompt 时保留用户意图，并补齐资产描述结构：
   - `[资产类型] + [具体主体] + [艺术风格] + [视角] + [光影细节] + [背景要求]`
5. 每张图只生成一个主体。不要把多个资产、多个变体或多个主体放在同一张图里；多个资产应分别调用 `/gi`，生成独立贴图。
6. 生成时启动名为 `painter` 的后台 subagent，让它运行 helper 的 `generate` 命令。helper 会创建占位图、调用 API、保存最终图并更新索引。
7. `painter` 完成后，报告生成图路径、占位图路径和索引路径。
8. 如果失败，报告明确错误，并说明占位图已保留。

helper 调用格式：

```bash
node skill/generate-image/scripts/generate-image.mjs generate --prompt "<prompt>" --size <size> [other args]
```

### 参数表

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `--prompt` | 图片提示词，也可作为位置参数传入 | 必填 |
| `--size` | `1024x1024`、`1024x1536`、`1536x1024`、`auto` | `auto` |
| `--model` | 图片模型名称 | `gpt-image-2` |
| `--url` | API base URL 覆盖值 | 初始化配置中的值 |
| `--apikey` / `--api-key` | API Key 覆盖值 | 初始化配置中的值 |
| `--output` | 输出目录；如果以 `.png`、`.jpg`、`.jpeg`、`.webp` 结尾，则视为最终文件路径 | `./.claybe/.generate-image` |
| `--output-file` | 最终图片文件路径 | 无 |
| `--index` | 图片索引字典文件路径 | `<输出目录>/image-index.json` |
| `--param key=value` | 透传给生成接口的额外参数，可重复 | 无 |
| `--config` | 自定义配置文件路径 | `~/.claude/generate-image/config.json` |

### 输出行为

- PNG 占位图：先写入最终图片路径
- 生成图：生成成功后用真实图片覆盖同一路径，路径来自 `generated-<timestamp>.png` 或 `--output-file` / 文件型 `--output` 指定路径
- 索引字典：默认 `<输出目录>/image-index.json`

索引键为图片路径；成功时 `placeholderPath` 与 `generatedPath` 相同，值包含 `prompt`、`placeholderPath`、`generatedPath`、`result`、`model`、`size`、`params` 和时间戳。失败时会记录错误，并在同一路径保留占位图。

### 安全注意事项

- 不要把 API Key 写进项目代码、README、issue、PR 或聊天摘要。
- 临时覆盖 API Key 时优先使用命令参数。
- helper 只把 API Key 写入用户目录 `~/.claude/generate-image/config.json`。

## English Guide

### Overview

`generate-image` generates images through an OpenAI Images API-compatible endpoint. Users configure the endpoint with `/gi-setup` and generate images with `/gi`.

Defaults:

- Model: `gpt-image-2` (legacy `gpt-image2` / `auto` config values are mapped to `gpt-image-2` by the helper)
- Size: `auto` (placeholder uses `1024x1024`)
- Output directory: `.claybe/.generate-image/` under the project directory
- Config file: `~/.claude/generate-image/config.json`

### Slash commands

#### `/gi-setup`

Saves API settings. Guide the user step by step for:

1. URL (API Base URL)
2. API Key
3. Whether to keep the default model `gpt-image-2`

If the user already provided some values, only ask for the missing ones. The project `setting.json` can also be used:

```text
/gi-setup --use-settings
```

Helper command:

```bash
node skill/generate-image/scripts/generate-image.mjs setup --use-settings
```

or:

```bash
node skill/generate-image/scripts/generate-image.mjs setup --url <url> --apikey <apikey> --model gpt-image-2
```

`setting.json` may contain top-level `apiBaseUrl` / `apiKey` / `model`, aliases `url` / `apikey`, or the same fields under `generateImage` or `generate-image`.

#### `/gi`

Generates an image. It accepts CLI-style parameters and can also extract parameters from natural language:

```text
/gi a cyberpunk night view of Shanghai, size 1536x1024, quality=high output-file=./.claybe/.generate-image/shanghai.png
```

If configuration is missing, do not only fail. Enter the `/gi-setup` flow and ask for URL/API Key, or ask whether to use the project `setting.json`.

### Agent rules

1. Extract from `/gi` input:
   - `prompt`
   - `size`
   - `model`
   - `output`
   - `output-file`
   - `index`
   - `url` / `apikey`
   - other `key=value` pairs as passthrough `--param key=value`
2. Use `auto` when `size` is not specified.
3. Use `gpt-image-2` when `model` is not specified.
4. Preserve the user's intent while completing this asset prompt structure:
   - `[asset type] + [specific subject] + [art style] + [view angle] + [lighting details] + [background requirements]`
5. Generate one subject per image. Do not put multiple assets, variants, or subjects into one image; call `/gi` separately for independent textures.
6. Start a background subagent named `painter` and have it run the helper `generate` command. The helper creates the placeholder, calls the API, saves the final image, and updates the index.
7. When `painter` finishes, report the generated image path, placeholder path, and index path.
8. On failure, report the clear error and mention that the placeholder remains available.

Helper command format:

```bash
node skill/generate-image/scripts/generate-image.mjs generate --prompt "<prompt>" --size <size> [other args]
```

### Parameters

| Parameter | Meaning | Default |
| --- | --- | --- |
| `--prompt` | Image prompt; can also be positional text | Required |
| `--size` | `1024x1024`, `1024x1536`, `1536x1024`, or `auto` | `auto` |
| `--model` | Image model name | `gpt-image-2` |
| `--url` | API base URL override | Config value |
| `--apikey` / `--api-key` | API key override | Config value |
| `--output` | Output directory; image-extension paths are treated as final file paths | `./.claybe/.generate-image` |
| `--output-file` | Final image file path | None |
| `--index` | Image index dictionary path | `<output directory>/image-index.json` |
| `--param key=value` | Extra API parameter; repeatable | None |
| `--config` | Custom config file path | `~/.claude/generate-image/config.json` |

### Output behavior

- PNG placeholder: first written to the final image path
- Generated image: on success, the real image overwrites the same path from `generated-<timestamp>.png` or the path specified by `--output-file` / file-style `--output`
- Index dictionary: defaults to `<output directory>/image-index.json`

The index key is the image path. On success, `placeholderPath` and `generatedPath` are the same path. Values include `prompt`, `placeholderPath`, `generatedPath`, `result`, `model`, `size`, `params`, and timestamps. On failure, the error is recorded and the placeholder remains at that same path.

### Security notes

- Do not commit API keys to source code, docs, issues, PRs, or summaries.
- Prefer runtime overrides for temporary keys.
- The helper only stores the API key in `~/.claude/generate-image/config.json`.
