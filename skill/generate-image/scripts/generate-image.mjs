#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.claude', 'generate-image', 'config.json');
const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), '.claybe', '.generate-image');
const DEFAULT_SETTINGS_PATH = path.join(process.cwd(), 'setting.json');
const DEFAULT_MODEL = 'gpt-image2';
const SIZE_RE = /^(\d+)x(\d+)$/;

function usage() {
  return `generate-image helper

Commands:
  setup --url <api-base-url> --apikey <api-key> [--model <model>] [--config <path>]
  setup --use-settings [--settings <path>] [--model <model>] [--config <path>]
  generate --prompt <text> [--size 1024x1024|1024x1536|1536x1024|auto] [--model <model>] [--url <api-base-url>] [--apikey <api-key>] [--output <dir>] [--output-file <path>] [--index <path>] [--param key=value]

Examples:
  node scripts/generate-image.mjs setup --url https://api.example.com/v1 --apikey sk-... --model gpt-image2
  node scripts/generate-image.mjs setup --use-settings
  node scripts/generate-image.mjs generate --prompt "a glass dragon" --size auto --param quality=high
`;
}

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  const args = { command, params: {}, positional: [] };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--param') {
      const pair = tokens[index + 1];
      index += 1;
      const equalIndex = pair?.indexOf('=') ?? -1;
      if (equalIndex <= 0) {
        throw new Error('--param 需要 key=value 格式');
      }
      args.params[pair.slice(0, equalIndex)] = coerceValue(pair.slice(equalIndex + 1));
      continue;
    }

    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = tokens[index + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        index += 1;
      }
      continue;
    }

    args.positional.push(token);
  }

  return args;
}

function coerceValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeModel(model) {
  return !model || model === 'auto' ? DEFAULT_MODEL : model;
}

function normalizeBaseUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('缺少 URL：请先运行 setup，或在 generate 中传入 --url');
  }
  return url.replace(/\/$/, '');
}

function normalizeSize(size) {
  if (!size || size === 'auto') {
    return { apiSize: size || '1024x1024', width: 1024, height: 1024 };
  }

  const match = SIZE_RE.exec(size);
  if (!match) {
    throw new Error(`size 必须是 1024x1024、1024x1536、1536x1024 或 auto，当前为：${size}`);
  }

  return { apiSize: size, width: Number(match[1]), height: Number(match[2]) };
}

function resolveOutputPaths(outputValue, outputFileValue) {
  if (outputFileValue) {
    const generatedPath = path.resolve(outputFileValue);
    return { outputDir: path.dirname(generatedPath), generatedPath };
  }

  if (outputValue && /\.(png|jpe?g|webp)$/i.test(outputValue)) {
    const generatedPath = path.resolve(outputValue);
    return { outputDir: path.dirname(generatedPath), generatedPath };
  }

  return { outputDir: path.resolve(outputValue || DEFAULT_OUTPUT_DIR), generatedPath: undefined };
}

async function readConfig(configPath) {
  try {
    return JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function readSettings(settingsPath) {
  try {
    return JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function pickSettingValue(settings, keys) {
  for (const key of keys) {
    if (settings?.[key]) return settings[key];
    if (settings?.generateImage?.[key]) return settings.generateImage[key];
    if (settings?.['generate-image']?.[key]) return settings['generate-image'][key];
  }
  return undefined;
}

async function readSettingsConfig(settingsPath) {
  const settings = await readSettings(settingsPath);
  return {
    apiBaseUrl: pickSettingValue(settings, ['apiBaseUrl', 'url', 'baseUrl']),
    apiKey: pickSettingValue(settings, ['apiKey', 'apikey', 'api-key']),
    model: pickSettingValue(settings, ['model'])
  };
}

async function writeConfig(configPath, config) {
  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try {
    await fs.chmod(configPath, 0o600);
  } catch {
    // chmod is best-effort on non-POSIX filesystems.
  }
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function createPlaceholder(outputDir, width, height, prompt) {
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `placeholder-${Date.now()}-${width}x${height}.svg`);
  const shortPrompt = prompt.length > 120 ? `${prompt.slice(0, 117)}...` : prompt;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#e5e7eb"/>
      <stop offset="100%" stop-color="#cbd5e1"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" fill="none" stroke="#64748b" stroke-width="4" stroke-dasharray="18 14"/>
  <text x="50%" y="45%" text-anchor="middle" font-family="Arial, sans-serif" font-size="42" fill="#334155">Generating image...</text>
  <text x="50%" y="52%" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#475569">${width} × ${height}</text>
  <text x="50%" y="59%" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#64748b">${escapeXml(shortPrompt)}</text>
</svg>
`;
  await fs.writeFile(filePath, svg, 'utf8');
  return filePath;
}

function pickImage(responseBody) {
  const first = responseBody?.data?.[0];
  if (first?.b64_json) return { type: 'base64', value: first.b64_json };
  if (first?.url) return { type: 'url', value: first.url };
  return null;
}

function getDefaultIndexPath(outputDir) {
  return path.join(outputDir, 'image-index.json');
}

async function updateImageIndex(indexPath, entry) {
  let existing = {};
  try {
    existing = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const nextIndex = {
    ...existing,
    [entry.generatedPath]: entry
  };
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, `${JSON.stringify(nextIndex, null, 2)}\n`, 'utf8');
}

async function saveGeneratedImage(outputDir, image, placeholderPath, outputFilePath) {
  await fs.mkdir(outputDir, { recursive: true });
  if (image.type === 'base64') {
    const filePath = outputFilePath || path.join(outputDir, `generated-${Date.now()}.png`);
    await fs.writeFile(filePath, Buffer.from(image.value, 'base64'));
    return filePath;
  }

  const response = await fetch(image.value);
  if (!response.ok) {
    throw new Error(`图片 URL 下载失败：HTTP ${response.status}\n占位图保留在：${placeholderPath}`);
  }
  const contentType = response.headers.get('content-type') || 'image/png';
  const extension = contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';
  const filePath = outputFilePath || path.join(outputDir, `generated-${Date.now()}.${extension}`);
  await fs.writeFile(filePath, Buffer.from(await response.arrayBuffer()));
  return filePath;
}

async function setup(args) {
  const configPath = args.config || DEFAULT_CONFIG_PATH;
  const settingsPath = args.settings || args['settings-path'] || DEFAULT_SETTINGS_PATH;
  const useSettings = args.settings === true || args['use-settings'] === true;
  const settingsConfig = useSettings || args.settings || args['settings-path'] ? await readSettingsConfig(settingsPath) : {};
  const nextConfig = {
    apiBaseUrl: normalizeBaseUrl(args.url || settingsConfig.apiBaseUrl),
    apiKey: args.apikey || args['api-key'] || settingsConfig.apiKey,
    model: normalizeModel(args.model || settingsConfig.model)
  };

  if (!nextConfig.apiKey) {
    throw new Error('缺少 API Key：请传入 --apikey，或使用 --use-settings 从 setting.json 读取');
  }

  await writeConfig(configPath, nextConfig);
  console.log(`generate-image setup 配置完成：${configPath}`);
  console.log('已保存 url、apikey 和默认 model。API Key 文件权限已设置为 600。');
}

function extractNaturalLanguageOptions(rawPrompt, explicitParams) {
  const extracted = {
    prompt: rawPrompt,
    size: undefined,
    model: undefined,
    url: undefined,
    apiKey: undefined,
    output: undefined,
    outputFile: undefined,
    index: undefined,
    params: {}
  };

  const keyValuePattern = /(^|[\s,，;；])([A-Za-z][\w-]*)=("[^"]*"|'[^']*'|[^\s,，;；]+)/g;
  extracted.prompt = extracted.prompt.replace(keyValuePattern, (match, prefix, key, value) => {
    const normalizedKey = key.toLowerCase();
    const cleanedValue = value.replace(/^['"]|['"]$/g, '');

    if (normalizedKey === 'size' && !explicitParams.size) {
      extracted.size = cleanedValue;
    } else if (normalizedKey === 'model' && !explicitParams.model) {
      extracted.model = cleanedValue;
    } else if ((normalizedKey === 'url' || normalizedKey === 'api-base-url') && !explicitParams.url) {
      extracted.url = cleanedValue;
    } else if ((normalizedKey === 'apikey' || normalizedKey === 'api-key') && !explicitParams.apikey && !explicitParams['api-key']) {
      extracted.apiKey = cleanedValue;
    } else if (normalizedKey === 'index' && !explicitParams.index) {
      extracted.index = cleanedValue;
    } else if (normalizedKey === 'output-file' && !explicitParams['output-file']) {
      extracted.outputFile = cleanedValue;
    } else if (normalizedKey === 'output' && !explicitParams.output) {
      extracted.output = cleanedValue;
    } else if (!(key in explicitParams.params)) {
      extracted.params[key] = coerceValue(cleanedValue);
    }

    return prefix;
  });

  if (!explicitParams.size) {
    const sizeMatch = /(?:尺寸|size)?\s*(1024x1024|1024x1536|1536x1024|auto)/i.exec(extracted.prompt);
    if (sizeMatch) {
      extracted.size = sizeMatch[1];
      extracted.prompt = extracted.prompt.replace(sizeMatch[0], ' ');
    }
  }

  extracted.prompt = extracted.prompt.replace(/\s+/g, ' ').replace(/^[,，;；\s]+|[,，;；\s]+$/g, '');
  return extracted;
}

function buildInitializationGuide(configPath, missingFields) {
  return `generate-image 尚未完成初始化，缺少：${missingFields.join('、')}\n\n已自动进入 /gi-setup 初始化流程。请按以下步骤配置：\n1. 请输入你的 URL（API Base URL），例如：https://api.example.com/v1\n2. 请输入你的 Key（API Key），格式通常类似 sk-...\n3. 也可以选择直接使用项目 setting.json 里的 URL 和 Key：/gi-setup --use-settings\n4. 默认模型为 gpt-image2；如需覆盖可传入 model=<模型名>\n5. 运行：\n  /gi-setup url=<你的 API Base URL> apikey=<你的 API Key> model=gpt-image2\n\n或直接运行 helper：\n  node skill/generate-image/scripts/generate-image.mjs setup --url <你的 API Base URL> --apikey <你的 API Key> --model gpt-image2\n  node skill/generate-image/scripts/generate-image.mjs setup --use-settings\n\n配置将保存到：${configPath}\n临时文件默认保存在：${DEFAULT_OUTPUT_DIR}\n安全提醒：不要把 API Key 提交到 git、issue、PR 或聊天摘要。`;
}

function assertConfigured(configPath, apiBaseUrl, apiKey) {
  const missingFields = [];
  if (!apiBaseUrl) missingFields.push('url');
  if (!apiKey) missingFields.push('apikey');
  if (missingFields.length > 0) {
    throw new Error(buildInitializationGuide(configPath, missingFields));
  }
}

async function generate(args) {
  const configPath = args.config || DEFAULT_CONFIG_PATH;
  const config = await readConfig(configPath);
  const rawPrompt = args.prompt || args.positional.join(' ');
  if (!rawPrompt) {
    throw new Error('缺少提示词：请传入 --prompt 或在命令末尾直接写提示词');
  }
  const naturalOptions = extractNaturalLanguageOptions(rawPrompt, args);
  const prompt = args.prompt ? rawPrompt : naturalOptions.prompt;

  const candidateApiBaseUrl = args.url || naturalOptions.url || config.apiBaseUrl;
  const apiKey = args.apikey || args['api-key'] || naturalOptions.apiKey || config.apiKey;
  assertConfigured(configPath, candidateApiBaseUrl, apiKey);
  const apiBaseUrl = normalizeBaseUrl(candidateApiBaseUrl);

  const size = normalizeSize(args.size || naturalOptions.size || 'auto');
  const model = normalizeModel(args.model || naturalOptions.model || config.model);
  const output = resolveOutputPaths(args.output || naturalOptions.output, args['output-file'] || naturalOptions.outputFile);
  const placeholderPath = await createPlaceholder(output.outputDir, size.width, size.height, prompt);
  const indexPath = path.resolve(args.index || naturalOptions.index || getDefaultIndexPath(output.outputDir));
  console.log(`占位图已生成：${placeholderPath}`);

  const endpoint = args.endpoint || `${apiBaseUrl}/images/generations`;
  const params = { ...naturalOptions.params, ...args.params };
  const body = {
    model,
    prompt,
    size: size.apiSize,
    ...params
  };

  const startedAt = Date.now();
  const baseIndexEntry = {
    prompt,
    placeholderPath,
    model,
    size: size.apiSize,
    params,
    endpoint,
    createdAt: new Date().toISOString()
  };
  const fail = async (message) => {
    await updateImageIndex(indexPath, {
      ...baseIndexEntry,
      generatedPath: placeholderPath,
      result: 'failure',
      error: message
    });
    throw new Error(`${message}\n占位图保留在：${placeholderPath}\n索引已更新：${indexPath}`);
  };

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    await fail(`图片生成失败：${error.message || error}`);
  }
  const responseBody = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = responseBody?.error ? JSON.stringify(responseBody.error) : `HTTP ${response.status}`;
    await fail(`图片生成失败：${message}`);
  }

  const image = pickImage(responseBody);
  if (!image) {
    await fail('图片生成失败：响应中没有 b64_json 或 url。');
  }

  let generatedPath;
  try {
    generatedPath = await saveGeneratedImage(output.outputDir, image, placeholderPath, output.generatedPath);
  } catch (error) {
    await fail(error.message || String(error));
  }
  const indexEntry = {
    ...baseIndexEntry,
    generatedPath,
    result: 'success',
    completedAt: new Date().toISOString()
  };
  await updateImageIndex(indexPath, indexEntry);
  console.log(`图片生成完成：${generatedPath}`);
  console.log(`索引已更新：${indexPath}`);
  console.log(`耗时：${((Date.now() - startedAt) / 1000).toFixed(1)} 秒`);
  console.log(JSON.stringify({ placeholderPath, generatedPath, indexPath, endpoint, model, size: size.apiSize }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.command === '--help' || args.command === '-h' || args.help) {
    console.log(usage());
    return;
  }

  if (args.command === 'setup') {
    await setup(args);
    return;
  }

  if (args.command === 'generate') {
    await generate(args);
    return;
  }

  throw new Error(`未知命令：${args.command}\n${usage()}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
