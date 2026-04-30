---
name: generate-image
description: Use when the user wants Claude Code to generate images from prompts, create same-resolution placeholders, run image generation in a background subagent named painter, pass image model parameters, choose an output directory or output file path, or use slash commands /gi and /gi-setup. If generation is requested before setup, automatically run the /gi-setup flow and guide the user step by step by asking for URL, key, and optional defaults.
argument-hint: "/gi-setup | <prompt> [--size auto] [--model gpt-image2] [--output <dir>|--output-file <path>] [--param key=value]"
---

# Generate Image Skill

## 中文说明

### 功能概述

`generate-image` 用于在 Claude Code 中通过 slash skill 生成图片。流程保持简化：接收 prompt 和参数，先生成一张与目标尺寸一致的占位图，再通过名为 `painter` 的后台 subagent 执行图片生成，拿到最终结果后用生成图替换占位图路径。

### Slash skill

本技能提供两个入口：

1. `/gi-setup`
   - 初始化 API 配置。
   - 运行后按步骤询问：请输入你的 URL、请输入你的 Key、是否使用默认模型 `gpt-image2`。
   - 用户也可以选择直接使用项目 `setting.json` 中的 URL 和 Key。
   - 用户提供后调用 helper 保存配置。
   - 默认 `model` 为 `gpt-image2`。

2. `/gi`
   - 根据提示词生成图片。
   - 如果还没有初始化，会自动进入初始化引导，提示用户配置 `url` 和 `apikey`。
   - 参数可以写在 slash 命令后面，也可以写在自然语言提示词里。
   - 调用时会先创建同分辨率占位图。
   - 图片生成通过名为 `painter` 的后台 subagent 执行。
   - 支持指定输出目录或最终图片文件路径。
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
node skill/generate-image/scripts/generate-image.mjs setup \
  --url https://api.example.com/v1 \
  --apikey sk-your-key \
  --model gpt-image2
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

简化执行链路：输入 prompt → 生成占位图 → 后台运行 `painter` subagent → 拿到最终结果后报告生成图路径，用最终结果替换占位图。

当用户使用 `/gi-setup` 时：

1. 不要要求用户一次性写完整命令；按顺序询问并收集：
   1. “请输入你的 URL（API Base URL）”
   2. “请输入你的 Key（API Key）”
   3. “默认模型为 gpt-image2，是否需要改成其他 model？”
2. 如果用户直接在 `/gi-setup` 后提供了 `url`、`apikey` 或 `model`，复用已提供的值，只追问缺失项。
3. 默认 `model` 为 `gpt-image2`。
4. 如果用户选择直接使用项目 `setting.json` 中的 URL 和 Key，调用 helper 的 `--use-settings`；也可用 `--settings <path>` 指定 setting.json 路径。
5. 信息齐全后调用：

```bash
node skill/generate-image/scripts/generate-image.mjs setup --url <url> --apikey <apikey> --model gpt-image2
```

当用户使用 `/gi` 时：

1. 从命令参数和自然语言中提取：
   - `prompt`
   - `size`
   - `model`
   - `output`
   - `output-file`（最终图片文件路径；也可把带 `.png`、`.jpg`、`.jpeg`、`.webp` 后缀的路径传给 `output`）
   - `index`（图片路径、提示词和生成结果的字典文件路径）
   - `url` / `apikey` 覆盖值
   - 其他可透传参数，使用 `--param key=value`
2. 如果配置文件不存在，或配置里缺少 `url` / `apikey`，不要只报错；自动进入 `/gi-setup` 初始化流程，并按步骤引导用户提供：
   1. “请输入你的 URL（API Base URL）”
   2. “请输入你的 Key（API Key）”
   3. “默认模型为 gpt-image2，是否需要改成其他 model？”
   4. “也可以直接使用项目 setting.json 里的 URL 和 Key 吗？”如果用户选择是，运行 `node skill/generate-image/scripts/generate-image.mjs setup --use-settings`。
   然后用收集到的信息运行 helper。
3. 如果用户没有明确尺寸，默认使用 `auto`。
4. 组织或改写 prompt 时，需要明确包含这些资产描述要素：`[资产类型] + [具体主体] + [艺术风格] + [视角] + [光影细节] + [背景要求]`。如果用户只给了简短描述，先在不改变用户意图的前提下补全这些要素，再传给 helper。
5. 创建占位图后，不要在主流程里等待图片生成；启动后台 subagent：
   - 名字必须是 `painter`。
   - 任务内容是运行 helper 的 `generate` 命令并保存最终图。
   - 把 prompt、size、model、output / output-file、index、url/apikey 覆盖值和所有 `--param` 原样传给 helper。
5. `painter` 完成后，用它返回的生成图片路径作为最终结果；向用户报告生成图路径和占位图路径。
6. 如果 `painter` 失败，报告错误信息，并说明占位图已保留。
7. helper 调用格式：

```bash
node skill/generate-image/scripts/generate-image.mjs generate --prompt "<prompt>" --size <size> [other args]
```

8. 成功时报告生成图片路径和占位图路径。
9. 失败时报告错误信息，并说明占位图已保留。

### 参数表

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `--prompt` | 图片提示词，也可作为位置参数传入 | 必填 |
| `--size` | 图片尺寸：`1024x1024`、`1024x1536`、`1536x1024`、`auto`（占位图按 `1024x1024` 创建） | `auto` |
| `--model` | 图片模型名称 | `gpt-image2` |
| `--url` | API base URL 覆盖值 | 初始化配置中的值 |
| `--apikey` / `--api-key` | API Key 覆盖值 | 初始化配置中的值 |
| `--output` | 输出目录；如果值以 `.png`、`.jpg`、`.jpeg`、`.webp` 结尾，则视为最终图片文件路径 | `./.claybe/.generate-image` |
| `--output-file` | 最终图片文件路径 | 无 |
| `--index` | 图片索引字典文件路径，记录图片路径、提示词和生成结果 | `<输出目录>/image-index.json` |
| `--param key=value` | 透传给生成接口的额外参数，可重复 | 无 |
| `--config` | 自定义配置文件路径 | `~/.claude/generate-image/config.json` |

### 输出行为

- 占位图：`placeholder-<timestamp>-<width>x<height>.svg`
- 生成图：`generated-<timestamp>.png|jpg|webp`，或 `--output-file` / 文件型 `--output` 指定的路径
- 默认目录：项目目录下的 `.claybe/.generate-image/`
- 索引字典：默认 `<输出目录>/image-index.json`，键为生成图片路径，值包含 `prompt`、`placeholderPath`、`generatedPath`、`result`、`model`、`size`、`params` 和时间戳

### 失败提示

常见失败与处理：

- 未初始化：自动进入 `/gi-setup` 初始化引导，按步骤询问 URL、Key，并使用默认模型 `gpt-image2`。
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

`generate-image` lets Claude Code generate images through slash skills. The flow stays intentionally simple: accept prompt and parameters, create a same-resolution placeholder, run image generation in a background subagent named `painter`, then report the final image path so it can replace the placeholder.

### Slash skills

This skill exposes two entries:

1. `/gi-setup`
   - Sets up API settings.
   - Requires `url` and `apikey`.
   - Optionally sets the default `model`.

2. `/gi`
   - Generates an image from a prompt.
   - If the skill is not set up yet, automatically enters the `/gi-setup` flow and asks for URL, key, and whether to keep the default model step by step.
   - Parameters can be passed after the slash command or described in natural language.
   - Creates a same-resolution placeholder before the API call.
   - Runs image generation in a background subagent named `painter`.
   - Supports an output directory or final image file path.
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
node skill/generate-image/scripts/generate-image.mjs setup \
  --url https://api.example.com/v1 \
  --apikey sk-your-key \
  --model gpt-image2
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

Simplified flow: input prompt → create placeholder → run background `painter` subagent → report the final image path so it can replace the placeholder.

For `/gi-setup`:

1. Do not require the user to write the full command up front; ask for values in order:
   1. “Please enter your URL (API Base URL).”
   2. “Please enter your Key (API Key).”
   3. “The default model is gpt-image2. Do you want to use another model?”
2. If the user already provided `url`, `apikey`, or `model` after `/gi-setup`, reuse provided values and only ask for missing ones.
3. Default `model` to `gpt-image2`.
4. If the user chooses to use the project `setting.json`, run:

```bash
node skill/generate-image/scripts/generate-image.mjs setup --use-settings
```

5. Once all required values are available, run:

```bash
node skill/generate-image/scripts/generate-image.mjs setup --url <url> --apikey <apikey> --model gpt-image2
```

For `/gi`:

1. Extract:
   - `prompt`
   - `size`
   - `model`
   - `output`
   - `output-file`（最终图片文件路径；也可把带 `.png`、`.jpg`、`.jpeg`、`.webp` 后缀的路径传给 `output`）
   - `index`（图片路径、提示词和生成结果的字典文件路径）
   - `url` / `apikey` overrides
   - passthrough parameters as `--param key=value`
2. If the config file does not exist, or if `url` / `apikey` is missing, do not only fail; automatically enter the `/gi-setup` flow and guide the user step by step to provide:
   1. “Please enter your URL (API Base URL).”
   2. “Please enter your Key (API Key).”
   3. “The default model is gpt-image2. Do you want to use another model?”
   4. “Do you want to use URL and Key from the project setting.json?” If yes, run `node skill/generate-image/scripts/generate-image.mjs setup --use-settings`.
   Then run the helper with the collected values.
3. Default to `auto` when size is not specified.
4. When composing or rewriting the prompt, include these asset description elements explicitly: `[asset type] + [specific subject] + [art style] + [view angle] + [lighting details] + [background requirements]`. If the user only gives a short description, enrich it with these elements without changing the user's intent before passing it to the helper.
5. After creating the placeholder, do not wait for image generation in the main flow; launch a background subagent:
   - Its name must be `painter`.
   - Its task is to run the helper `generate` command and save the final image.
   - Pass prompt, size, model, output / output-file, index, url/apikey overrides, and all `--param` values through unchanged.
5. When `painter` finishes, use its generated image path as the final result; report both the generated image path and placeholder path.
6. If `painter` fails, report the error and mention that the placeholder remains available.
7. Helper command format:

```bash
node skill/generate-image/scripts/generate-image.mjs generate --prompt "<prompt>" --size <size> [other args]
```

8. On success, report the generated image path and placeholder path.
9. On failure, report the error and mention that the placeholder remains available.

### Parameters

| Parameter | Meaning | Default |
| --- | --- | --- |
| `--prompt` | Image prompt; can also be passed as positional text | Required |
| `--size` | Image size: `1024x1024`, `1024x1536`, `1536x1024`, or `auto` (placeholder uses `1024x1024`) | `auto` |
| `--model` | Image model name | `gpt-image2` |
| `--url` | API base URL override | Config value |
| `--apikey` / `--api-key` | API key override | Config value |
| `--output` | Output directory; if the value ends with `.png`, `.jpg`, `.jpeg`, or `.webp`, it is treated as the final image file path | `./.claybe/.generate-image` |
| `--output-file` | Final image file path | None |
| `--index` | Image index dictionary file path; records image paths, prompts, and generation results | `<output directory>/image-index.json` |
| `--param key=value` | Extra API parameter; repeatable | None |
| `--config` | Custom config path | `~/.claude/generate-image/config.json` |

### Output behavior

- Placeholder: `placeholder-<timestamp>-<width>x<height>.svg`
- Generated image: `generated-<timestamp>.png|jpg|webp`, or the path specified by `--output-file` / file-style `--output`
- Default directory: `.claybe/.generate-image/` under the project directory.
- Index dictionary: defaults to `<output directory>/image-index.json`; keys are generated image paths, values include `prompt`, `placeholderPath`, `generatedPath`, `result`, `model`, `size`, `params`, and timestamps.

### Failure handling

Common failures:

- Not set up: automatically enter `/gi-setup` and ask for URL, key, and whether to keep the default model step by step.
- Missing API key: pass `--apikey` or run `/gi-setup` again.
- Non-2xx API response: the helper prints `图片生成失败：...`.
- Response has no image: the helper reports missing `b64_json` or `url`.
- URL download failure: the helper prints the HTTP status.

### Security notes

- Do not commit API keys to source code, docs, issues, PRs, or summaries.
- Use runtime overrides for temporary keys.
- The helper only stores the API key in the user's `~/.claude/generate-image/config.json` file.
