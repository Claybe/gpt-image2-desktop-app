---
name: generate-image
description: Use when the user wants Claude Code to set up an image generation API with /generate-image:steup, generate images from prompts, pass image model parameters, create same-resolution placeholders before generation, or use slash commands /generate-image and /generate-image:steup. If generation is requested before setup, automatically run the steup flow and guide the user step by step.
argument-hint: "steup --url <url> --apikey <key> | <prompt> [--size 1024x1024] [--model gpt-image-2] [--param key=value]"
---

# Generate Image Skill

## 中文说明

### 功能概述

`generate-image` 用于在 Claude Code 中通过 slash skill 调用图片生成接口。它复刻当前桌面应用的核心生成链路：读取 URL/API Key/model 配置，接收提示词和参数，先生成一张与目标尺寸一致的占位图，再调用兼容 OpenAI Images API 风格的图片生成接口，最后把生成图片保存到本地。

### Slash skill

本技能提供两个入口：

1. `/generate-image:steup`
   - 初始化 API 配置。
   - 必须设置 `url` 和 `apikey`。
   - 可选设置默认 `model`。

2. `/generate-image`
   - 根据提示词生成图片。
   - 如果还没有初始化，会自动进入初始化引导，提示用户配置 `url` 和 `apikey`。
   - 参数可以写在 slash 命令后面，也可以写在自然语言提示词里。
   - 调用时会先创建同分辨率占位图。
   - 如果生成失败，明确提示失败原因，并保留占位图路径。

### npx skills 安装

本仓库包含 `skills.json`，可以用 `skills` CLI 从 GitHub 安装：

```bash
npx --yes skills add Claybe/gpt-image2-desktop-app --skill generate-image --agent claude-code --global --copy --yes
```

也可以安装到当前项目：

```bash
npx --yes skills add Claybe/gpt-image2-desktop-app --skill generate-image --agent claude-code --copy --yes
```

安装后重启 Claude Code 或开启新会话，让 skill 列表重新加载。

### 初始化配置

使用 helper 脚本保存配置：

```bash
node skill/generate-image/scripts/generate-image.mjs steup \
  --url https://api.example.com/v1 \
  --apikey sk-your-key \
  --model gpt-image-2
```

配置默认保存到：

```text
~/.claude/generate-image/config.json
```

文件权限会尽量设置为 `600`，避免 API Key 被其他用户读取。

### 生成图片

最小用法：

```bash
node skill/generate-image/scripts/generate-image.mjs generate \
  --prompt "一只透明玻璃小龙坐在发光键盘旁" \
  --size 1024x1024
```

等价的自然语言式写法：

```bash
node skill/generate-image/scripts/generate-image.mjs generate "一只透明玻璃小龙坐在发光键盘旁" --size 1024x1024
```

传入额外模型参数：

```bash
node skill/generate-image/scripts/generate-image.mjs generate \
  --prompt "cinematic product photo of a ceramic tea cup" \
  --size 1536x1024 \
  --model gpt-image-2 \
  --param quality=high \
  --param background=transparent
```

### Agent 执行规则

当用户使用 `/generate-image:steup` 时：

1. 从用户输入提取 `url`、`apikey`、可选 `model`。
2. 如果缺少 `url` 或 `apikey`，提示用户补齐。
3. 调用：

```bash
node skill/generate-image/scripts/generate-image.mjs steup --url <url> --apikey <apikey> --model <model>
```

当用户使用 `/generate-image` 时：

1. 从命令参数和自然语言中提取：
   - `prompt`
   - `size`
   - `model`
   - `output`
   - `url` / `apikey` 覆盖值
   - 其他可透传参数，使用 `--param key=value`
2. 如果配置文件不存在，或配置里缺少 `url` / `apikey`，不要只报错；自动进入 `/generate-image:steup` 初始化流程，并按步骤引导用户提供：
   1. API Base URL
   2. API Key
   3. 可选默认模型（默认 `gpt-image-2`）
   然后提示运行 `/generate-image:steup url=<...> apikey=<...> model=gpt-image-2`。
3. 如果用户没有明确尺寸，默认使用 `1024x1024`。
4. 调用 helper 脚本前，告诉用户将先生成同尺寸占位图。
5. 调用：

```bash
node skill/generate-image/scripts/generate-image.mjs generate --prompt "<prompt>" --size <size> [other args]
```

6. 成功时报告生成图片路径和占位图路径。
7. 失败时报告错误信息，并说明占位图已保留。

### 参数表

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `--prompt` | 图片提示词，也可作为位置参数传入 | 必填 |
| `--size` | 图片尺寸：`1024x1024`、`1024x1536`、`1536x1024`、`auto`（占位图按 `1024x1024` 创建） | `1024x1024` |
| `--model` | 图片模型名称 | `gpt-image-2` |
| `--url` | API base URL 覆盖值 | 初始化配置中的值 |
| `--apikey` / `--api-key` | API Key 覆盖值 | 初始化配置中的值 |
| `--output` | 输出目录 | `./generated-images` |
| `--param key=value` | 透传给生成接口的额外参数，可重复 | 无 |
| `--config` | 自定义配置文件路径 | `~/.claude/generate-image/config.json` |

### 输出行为

- 占位图：`placeholder-<timestamp>-<width>x<height>.svg`
- 生成图：`generated-<timestamp>.png|jpg|webp`
- 默认目录：当前工作目录下的 `generated-images/`

### 失败提示

常见失败与处理：

- 未初始化：自动进入初始化引导，提示运行 `/generate-image:steup url=<...> apikey=<...> model=gpt-image-2`。
- API Key 缺失：补充 `--apikey` 或重新初始化。
- 接口返回非 2xx：显示 `图片生成失败：...`。
- 响应没有图片：显示 `响应中没有 b64_json 或 url`。
- URL 图片下载失败：显示 HTTP 状态码。

### 安全注意事项

- 不要把 API Key 写进项目代码、README、issue、PR 或聊天摘要。
- 如果需要临时覆盖 API Key，优先使用命令参数，不要提交配置文件。
- helper 只把 API Key 写入用户目录 `~/.claude/generate-image/config.json`。

## English Guide

### Overview

`generate-image` lets Claude Code invoke an image generation API through slash skills. It mirrors the desktop app's core generation flow: read URL/API key/model settings, accept a prompt and parameters, create a same-resolution placeholder first, call an OpenAI Images API-compatible generation endpoint, then save the final image locally.

### Slash skills

This skill exposes two entries:

1. `/generate-image:steup`
   - Sets up API settings.
   - Requires `url` and `apikey`.
   - Optionally sets the default `model`.

2. `/generate-image`
   - Generates an image from a prompt.
   - If the skill is not set up yet, automatically enters the `/generate-image:steup` setup flow and asks the user to provide `url` and `apikey` step by step.
   - Parameters can be passed after the slash command or described in natural language.
   - Creates a same-resolution placeholder before the API call.
   - On failure, reports the error and keeps the placeholder path.

### Install with npx skills

This repository includes `skills.json`, so you can install the skill from GitHub with the `skills` CLI:

```bash
npx --yes skills add Claybe/gpt-image2-desktop-app --skill generate-image --agent claude-code --global --copy --yes
```

Project-local install:

```bash
npx --yes skills add Claybe/gpt-image2-desktop-app --skill generate-image --agent claude-code --copy --yes
```

Restart Claude Code or open a new session after installation so the skill list is reloaded.

### setup

```bash
node skill/generate-image/scripts/generate-image.mjs steup \
  --url https://api.example.com/v1 \
  --apikey sk-your-key \
  --model gpt-image-2
```

Default config path:

```text
~/.claude/generate-image/config.json
```

The helper attempts to set file permissions to `600`.

### Generate an image

Minimal example:

```bash
node skill/generate-image/scripts/generate-image.mjs generate \
  --prompt "a tiny glass dragon sitting beside a glowing keyboard" \
  --size 1024x1024
```

Natural prompt style:

```bash
node skill/generate-image/scripts/generate-image.mjs generate "a tiny glass dragon sitting beside a glowing keyboard" --size 1024x1024
```

Extra model parameters:

```bash
node skill/generate-image/scripts/generate-image.mjs generate \
  --prompt "cinematic product photo of a ceramic tea cup" \
  --size 1536x1024 \
  --model gpt-image-2 \
  --param quality=high \
  --param background=transparent
```

### Agent instructions

For `/generate-image:steup`:

1. Extract `url`, `apikey`, and optional `model` from the user's request.
2. If `url` or `apikey` is missing, ask the user to provide it.
3. Run:

```bash
node skill/generate-image/scripts/generate-image.mjs steup --url <url> --apikey <apikey> --model <model>
```

For `/generate-image`:

1. Extract:
   - `prompt`
   - `size`
   - `model`
   - `output`
   - `url` / `apikey` overrides
   - passthrough parameters as `--param key=value`
2. If the config file does not exist, or if `url` / `apikey` is missing, do not only fail; automatically enter the `/generate-image:steup` setup flow and guide the user step by step to provide:
   1. API Base URL
   2. API Key
   3. Optional default model (defaults to `gpt-image-2`)
   Then ask the user to run `/generate-image:steup url=<...> apikey=<...> model=gpt-image-2`.
3. Default to `1024x1024` when size is not specified.
4. Tell the user that a same-resolution placeholder will be created first.
5. Run:

```bash
node skill/generate-image/scripts/generate-image.mjs generate --prompt "<prompt>" --size <size> [other args]
```

6. On success, report the generated image path and placeholder path.
7. On failure, report the error and mention that the placeholder remains available.

### Parameters

| Parameter | Meaning | Default |
| --- | --- | --- |
| `--prompt` | Image prompt; can also be passed as positional text | Required |
| `--size` | Image size: `1024x1024`, `1024x1536`, `1536x1024`, or `auto` (placeholder uses `1024x1024`) | `1024x1024` |
| `--model` | Image model name | `gpt-image-2` |
| `--url` | API base URL override | Config value |
| `--apikey` / `--api-key` | API key override | Config value |
| `--output` | Output directory | `./generated-images` |
| `--param key=value` | Extra API parameter; repeatable | None |
| `--config` | Custom config path | `~/.claude/generate-image/config.json` |

### Output behavior

- Placeholder: `placeholder-<timestamp>-<width>x<height>.svg`
- Generated image: `generated-<timestamp>.png|jpg|webp`
- Default directory: `generated-images/` under the current working directory.

### Failure handling

Common failures:

- Not set up: automatically enter `/generate-image:steup` and guide the user step by step.
- Missing API key: pass `--apikey` or run `/generate-image:steup` again.
- Non-2xx API response: the helper prints `图片生成失败：...`.
- Response has no image: the helper reports missing `b64_json` or `url`.
- URL download failure: the helper prints the HTTP status.

### Security notes

- Do not commit API keys to source code, docs, issues, PRs, or summaries.
- Use runtime overrides for temporary keys.
- The helper only stores the API key in the user's `~/.claude/generate-image/config.json` file.
