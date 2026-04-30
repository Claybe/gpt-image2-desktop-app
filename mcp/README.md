# GPT Image 2 Studio MCP

这个目录提供一个 stdio MCP server，用项目内 `generate-image` helper 调用 GPT Image 2 Studio / OpenAI Images API 兼容接口。

## 启动

```bash
npm run mcp:gpt-image2-studio
```

Claude Desktop / Claude Code MCP 配置示例：

```json
{
  "mcpServers": {
    "gpt-image2-studio": {
      "command": "node",
      "args": ["/Users/claybe/ProjectsGit/gpt-image2-desktop-app/mcp/gpt-image2-studio.mjs"]
    }
  }
}
```

## Tools

- `setup_gpt_image2_studio`：保存 API Base URL、API Key、默认模型；也可读取项目 `setting.json`。
- `generate_gpt_image2_asset`：按资产提示词结构生成单主体图片。
- `generate_gpt_image2_from_prompt`：直接使用完整 prompt 生成图片。

## Prompt 结构

`generate_gpt_image2_asset` 会组织为：

```text
[资产类型] + [具体主体] + [艺术风格] + [视角] + [光影细节] + [背景要求] + [补充要求]
```

每次只生成一个主体；多个资产应分别调用 tool。

## 输出

底层 helper 会生成：

- 占位图：先写入最终图片路径
- 最终图：生成成功后用真实图片覆盖同一路径
- 索引：默认 `<输出目录>/image-index.json`

失败时会在同一路径保留占位图并更新索引。

## 安全

不要把 API Key 写进项目代码、README、issue、PR 或聊天摘要。`setup_gpt_image2_studio` 默认只把 Key 保存到用户目录 `~/.claude/generate-image/config.json`。
