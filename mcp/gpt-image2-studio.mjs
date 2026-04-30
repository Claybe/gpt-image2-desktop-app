#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const helperPath = path.join(projectRoot, 'skill', 'generate-image', 'scripts', 'generate-image.mjs');

function buildPrompt({ assetType, subject, artStyle, viewAngle, lightingDetails, backgroundRequirements, prompt }) {
  const parts = [
    assetType && `[资产类型] ${assetType}`,
    subject && `[具体主体] ${subject}`,
    artStyle && `[艺术风格] ${artStyle}`,
    viewAngle && `[视角] ${viewAngle}`,
    lightingDetails && `[光影细节] ${lightingDetails}`,
    backgroundRequirements && `[背景要求] ${backgroundRequirements}`
  ].filter(Boolean);

  if (prompt) {
    parts.push(`[补充要求] ${prompt}`);
  }

  return parts.join(' + ');
}

function appendOptionalArgs(args, options) {
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === '') continue;
    args.push(`--${key}`, String(value));
  }
}

function appendParams(args, params = {}) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    args.push('--param', `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }
}

function runHelper(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [helperPath, ...args], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    child.on('error', (error) => {
      resolve({ code: 1, stdout, stderr: error.message });
    });
  });
}

function parseLastJson(stdout) {
  const match = /\{[\s\S]*\}\s*$/.exec(stdout.trim());
  if (!match) return undefined;

  try {
    return JSON.parse(match[0]);
  } catch {
    return undefined;
  }
}

function helperResult(result) {
  const text = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
  const structuredContent = parseLastJson(result.stdout);

  return {
    content: [{ type: 'text', text: text || `helper exited with code ${result.code}` }],
    structuredContent,
    isError: result.code !== 0
  };
}

const server = new McpServer(
  {
    name: 'gpt-image2-studio',
    version: '0.1.0'
  },
  {
    instructions:
      '通过项目内 generate-image helper 使用 GPT Image 2 Studio。生成 prompt 时遵循：[资产类型] + [具体主体] + [艺术风格] + [视角] + [光影细节] + [背景要求]，每张图只生成一个主体。不要在响应中泄露 API Key。'
  }
);

server.registerTool(
  'setup_gpt_image2_studio',
  {
    title: 'Setup GPT Image 2 Studio',
    description: '保存 GPT Image 2 Studio / OpenAI Images API 兼容接口配置。API Key 会写入用户目录 ~/.claude/generate-image/config.json。',
    inputSchema: z.object({
      url: z.string().optional().describe('API Base URL，例如 https://api.example.com/v1'),
      apiKey: z.string().optional().describe('API Key；也可使用 useSettings 从 setting.json 读取'),
      model: z.string().default('gpt-image-2').describe('默认图片模型'),
      useSettings: z.boolean().default(false).describe('是否从项目 setting.json 读取 url/apiKey/model'),
      settings: z.string().optional().describe('自定义 setting.json 路径'),
      config: z.string().optional().describe('自定义配置文件路径')
    })
  },
  async ({ url, apiKey, model, useSettings, settings, config }) => {
    const args = ['setup'];
    if (useSettings) args.push('--use-settings');
    appendOptionalArgs(args, { url, apikey: apiKey, model, settings, config });
    return helperResult(await runHelper(args));
  }
);

server.registerTool(
  'generate_gpt_image2_asset',
  {
    title: 'Generate GPT Image 2 Asset',
    description: '按 GPT Image 2 Studio 的资产提示词结构生成单主体图片，创建占位图、调用接口、保存图片并更新索引。',
    inputSchema: z.object({
      assetType: z.string().describe('资产类型，例如 游戏道具图标、角色立绘、UI 背景'),
      subject: z.string().describe('具体主体；每次只填写一个主体'),
      artStyle: z.string().describe('艺术风格'),
      viewAngle: z.string().describe('视角'),
      lightingDetails: z.string().describe('光影细节'),
      backgroundRequirements: z.string().describe('背景要求'),
      prompt: z.string().optional().describe('额外补充要求，会附加到结构化 prompt 后'),
      size: z.enum(['1024x1024', '1024x1536', '1536x1024', 'auto']).default('auto'),
      model: z.string().default('gpt-image-2'),
      url: z.string().optional().describe('临时覆盖 API Base URL'),
      apiKey: z.string().optional().describe('临时覆盖 API Key，不会写入项目代码'),
      output: z.string().optional().describe('输出目录；若以图片扩展名结尾则作为最终文件路径'),
      outputFile: z.string().optional().describe('最终图片文件路径'),
      index: z.string().optional().describe('图片索引字典路径'),
      config: z.string().optional().describe('自定义配置文件路径'),
      params: z.record(z.string(), z.unknown()).default({}).describe('透传给图片接口的额外参数，例如 {"quality":"high"}')
    })
  },
  async (input) => {
    const prompt = buildPrompt(input);
    const args = ['generate', '--prompt', prompt, '--size', input.size];
    appendOptionalArgs(args, {
      model: input.model,
      url: input.url,
      apikey: input.apiKey,
      output: input.output,
      'output-file': input.outputFile,
      index: input.index,
      config: input.config
    });
    appendParams(args, input.params);
    return helperResult(await runHelper(args));
  }
);

server.registerTool(
  'generate_gpt_image2_from_prompt',
  {
    title: 'Generate GPT Image 2 From Prompt',
    description: '直接使用完整 prompt 生成图片，同时支持 size、model、output、index 和任意 params。',
    inputSchema: z.object({
      prompt: z.string().describe('完整图片提示词'),
      size: z.enum(['1024x1024', '1024x1536', '1536x1024', 'auto']).default('auto'),
      model: z.string().default('gpt-image-2'),
      url: z.string().optional(),
      apiKey: z.string().optional(),
      output: z.string().optional(),
      outputFile: z.string().optional(),
      index: z.string().optional(),
      config: z.string().optional(),
      params: z.record(z.string(), z.unknown()).default({})
    })
  },
  async ({ prompt, size, model, url, apiKey, output, outputFile, index, config, params }) => {
    const args = ['generate', '--prompt', prompt, '--size', size];
    appendOptionalArgs(args, { model, url, apikey: apiKey, output, 'output-file': outputFile, index, config });
    appendParams(args, params);
    return helperResult(await runHelper(args));
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
