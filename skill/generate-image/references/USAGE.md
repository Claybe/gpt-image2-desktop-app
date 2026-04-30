# Generate Image Skill 使用文档 / User Guide

## 中文

### 简介

`generate-image` 是一个 Claude Code skill，用于通过兼容 OpenAI Images API 的接口生成图片。它提供两个入口：`/gi-setup` 初始化 API 配置，`/gi` 生成图片。默认模型为 `gpt-image-2`（兼容旧配置里的 `gpt-image2` / `auto`，helper 会映射为 `gpt-image-2`），默认尺寸为 `auto`，默认输出目录为项目目录下的 `.claybe/.generate-image/`。

生成时由名为 `painter` 的后台 subagent 运行 helper。helper 会创建占位图、调用图片接口、保存最终图片，并更新图片索引字典。

### 安装

全局安装到 Claude Code：

```bash
npx --yes skills add Claybe/gpt-image2-desktop-app --skill generate-image --agent claude-code --global --copy --yes
```

安装到当前项目：

```bash
npx --yes skills add Claybe/gpt-image2-desktop-app --skill generate-image --agent claude-code --copy --yes
```

安装后重启 Claude Code 或开启新会话。

### 初始化：/gi-setup

手动提供 URL 和 Key：

```text
/gi-setup url=https://api.example.com/v1 apikey=sk-xxx model=gpt-image-2
```

对应 helper：

```bash
node skill/generate-image/scripts/generate-image.mjs setup --url https://api.example.com/v1 --apikey sk-xxx --model gpt-image-2
```

也可以直接读取项目 `setting.json`：

```text
/gi-setup --use-settings
```

对应 helper：

```bash
node skill/generate-image/scripts/generate-image.mjs setup --use-settings
```

如需指定 settings 路径：

```bash
node skill/generate-image/scripts/generate-image.mjs setup --use-settings --settings ./setting.json
```

`setting.json` 支持 `apiBaseUrl` / `apiKey` / `model`，也支持 `url` / `apikey`，以及嵌套在 `generateImage` 或 `generate-image` 下。

### 未初始化时

如果直接使用 `/gi`，但尚未配置 URL 或 API Key，skill 会进入 `/gi-setup` 引导流程，而不是只返回失败：

1. 请输入你的 URL（API Base URL）
2. 请输入你的 Key（API Key）
3. 默认模型为 `gpt-image-2`，如需覆盖可提供其他 model
4. 也可以选择使用项目 `setting.json`

### 生成：/gi

示例：

```text
/gi 一张赛博朋克风格的上海夜景，尺寸 1536x1024，quality=high output-file=./.claybe/.generate-image/shanghai.png
```

对应 helper：

```bash
node skill/generate-image/scripts/generate-image.mjs generate \
  --prompt "一张赛博朋克风格的上海夜景" \
  --size 1536x1024 \
  --output-file ./.claybe/.generate-image/shanghai.png \
  --param quality=high
```

### Prompt 结构要求

Agent 使用 `/gi` 时，应在不改变用户意图的前提下补齐以下结构：

```text
[资产名称/用途] + [资产类型] + [具体主体] + [艺术风格] + [视角] + [光影细节] + [背景要求]
```

每张图片只生成一个主体。不要在同一张图里放多个资产、多个变体或多个主体；多个资产应分别生成独立贴图。

示例：

```text
[资产名称/用途] STG 竖屏游戏玩家小飞机 + [资产类型] 游戏道具贴图 + [具体主体] 小飞机 + [艺术风格] 干净 3D 卡通风格 + [视角] 正侧面微俯视 + [光影细节] 柔和棚拍光、清晰高光 + [背景要求] 透明背景
```

### 参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| prompt | 是 | 图片提示词 |
| size | 否 | `1024x1024`、`1024x1536`、`1536x1024`、`auto`；默认 `auto` |
| model | 否 | 默认 `gpt-image-2` |
| url | 否 | 覆盖初始化 URL |
| apikey | 否 | 覆盖初始化 API Key |
| output | 否 | 输出目录；如果值以 `.png`、`.jpg`、`.jpeg`、`.webp` 结尾，则视为最终图片路径 |
| output-file | 否 | 最终图片路径 |
| index | 否 | 图片索引字典路径；默认 `<输出目录>/image-index.json` |
| param | 否 | 任意透传参数，格式 `key=value` |

### 输出与错误

- PNG 占位图：先写入最终图片路径
- 生成图：生成成功后用真实图片覆盖同一路径，路径默认会从资产名称/用途或具体主体生成，例如 `小飞机-<timestamp>.png` 或 `output-file` / 文件型 `output` 指定
- 索引字典：默认 `<输出目录>/image-index.json`

索引用于按图片路径查询 prompt 和生成结果。成功时 `placeholderPath` 与 `generatedPath` 相同；生成失败时会记录错误，并在同一路径保留占位图，方便 UI 或后续流程继续展示状态。

常见错误包括：API Key 缺失、URL 缺失、接口 HTTP 错误、响应中没有图片数据、URL 图片下载失败。

## English

### Introduction

`generate-image` is a Claude Code skill for generating images through an OpenAI Images API-compatible endpoint. It provides two entries: `/gi-setup` configures API settings, and `/gi` generates images. The default model is `gpt-image-2` (legacy `gpt-image2` / `auto` config values are mapped to `gpt-image-2` by the helper), the default size is `auto`, and the default output directory is `.claybe/.generate-image/` under the project directory.

Generation is delegated to a background subagent named `painter`. The helper creates the placeholder, calls the image API, saves the final image, and updates the image index dictionary.

### Install

Global install for Claude Code:

```bash
npx --yes skills add Claybe/gpt-image2-desktop-app --skill generate-image --agent claude-code --global --copy --yes
```

Project-local install:

```bash
npx --yes skills add Claybe/gpt-image2-desktop-app --skill generate-image --agent claude-code --copy --yes
```

Restart Claude Code or open a new session after installation.

### Setup: /gi-setup

Provide URL and Key manually:

```text
/gi-setup url=https://api.example.com/v1 apikey=sk-xxx model=gpt-image-2
```

Helper command:

```bash
node skill/generate-image/scripts/generate-image.mjs setup --url https://api.example.com/v1 --apikey sk-xxx --model gpt-image-2
```

Or read the project `setting.json`:

```text
/gi-setup --use-settings
```

Helper command:

```bash
node skill/generate-image/scripts/generate-image.mjs setup --use-settings
```

To specify a settings path:

```bash
node skill/generate-image/scripts/generate-image.mjs setup --use-settings --settings ./setting.json
```

`setting.json` supports `apiBaseUrl` / `apiKey` / `model`, aliases `url` / `apikey`, and the same fields under `generateImage` or `generate-image`.

### When not set up

If `/gi` is used before URL or API key configuration exists, the skill enters the `/gi-setup` flow instead of only failing:

1. Please enter your URL (API Base URL)
2. Please enter your Key (API Key)
3. The default model is `gpt-image-2`; provide another model only if needed
4. Or choose to use the project `setting.json`

### Generate: /gi

Example:

```text
/gi a cyberpunk night view of Shanghai, size 1536x1024, quality=high output-file=./.claybe/.generate-image/shanghai.png
```

Helper command:

```bash
node skill/generate-image/scripts/generate-image.mjs generate \
  --prompt "a cyberpunk night view of Shanghai" \
  --size 1536x1024 \
  --output-file ./.claybe/.generate-image/shanghai.png \
  --param quality=high
```

### Prompt structure requirements

When an agent uses `/gi`, complete this structure without changing the user's intent:

```text
[asset name/purpose] + [asset type] + [specific subject] + [art style] + [view angle] + [lighting details] + [background requirements]
```

Generate one subject per image. Do not put multiple assets, variants, or subjects in the same image; generate separate independent textures instead.

Example:

```text
[asset name/purpose] vertical STG player airplane + [asset type] game prop texture + [specific subject] small airplane + [art style] clean 3D cartoon style + [view angle] front-side slight top-down view + [lighting details] soft studio lighting with crisp highlights + [background requirements] transparent background
```

### Parameters

| Parameter | Required | Description |
| --- | --- | --- |
| prompt | Yes | Image prompt |
| size | No | `1024x1024`, `1024x1536`, `1536x1024`, or `auto`; defaults to `auto` |
| model | No | Defaults to `gpt-image-2` |
| url | No | Overrides configured URL |
| apikey | No | Overrides configured API key |
| output | No | Output directory; image-extension paths are treated as final image paths |
| output-file | No | Final image path |
| index | No | Image index dictionary path; defaults to `<output directory>/image-index.json` |
| param | No | Passthrough parameter in `key=value` format |

### Output and errors

- PNG placeholder: first written to the final image path
- Generated image: on success, the real image overwrites that same path derived from the asset name/purpose or specific subject, for example `small-airplane-<timestamp>.png` or the path specified by `output-file` / file-style `output`
- Index dictionary: defaults to `<output directory>/image-index.json`

The index maps image paths to prompts and generation results. On success, `placeholderPath` and `generatedPath` are the same path. On failure, the error is recorded and the PNG placeholder remains at that same path for UI or follow-up workflows.

Common errors include missing API key, missing URL, HTTP errors from the API, no image data in the response, and failed downloads from returned image URLs.
