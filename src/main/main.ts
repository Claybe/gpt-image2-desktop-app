import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { GenerateImageRequest, GenerateImageResult, GenerateImageTimings, ImageAsset } from '../shared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatedImageUrls = new Set<string>();

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 720,
    title: 'GPT Image 2 Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.setMenu(null);
  window.removeMenu();

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function dataUrlToBuffer(asset: ImageAsset): Buffer {
  const base64 = asset.dataUrl.split(',')[1] ?? '';
  return Buffer.from(base64, 'base64');
}

function safeMimeType(mimeType: string): string {
  return ['image/png', 'image/jpeg', 'image/webp'].includes(mimeType) ? mimeType : 'image/png';
}

function safeUploadFileName(prefix: string, index: number, mimeType: string): string {
  const extensionByMimeType: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp'
  };
  return `${prefix}-${index + 1}.${extensionByMimeType[safeMimeType(mimeType)] ?? 'png'}`;
}

function appendMultipartField(parts: Buffer[], boundary: string, name: string, value: string): void {
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
}

function appendMultipartFile(parts: Buffer[], boundary: string, name: string, fileName: string, mimeType: string, data: Buffer): void {
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${fileName}"\r\nContent-Type: ${safeMimeType(mimeType)}\r\n\r\n`, 'utf8'));
  parts.push(data);
  parts.push(Buffer.from('\r\n', 'utf8'));
}

function createEditMultipartBody(request: GenerateImageRequest, includeUrlOutput: boolean): { body: Buffer; contentType: string } {
  const boundary = `----gpt-image2-${Date.now().toString(16)}`;
  const parts: Buffer[] = [];

  appendMultipartField(parts, boundary, 'model', request.settings.model);
  appendMultipartField(parts, boundary, 'prompt', request.prompt);
  appendMultipartField(parts, boundary, 'size', request.size);
  if (includeUrlOutput) {
    appendMultipartField(parts, boundary, 'response_format', 'url');
  }

  request.referenceImages.forEach((image, index) => {
    appendMultipartFile(parts, boundary, 'image', safeUploadFileName('reference', index, image.mimeType), image.mimeType, dataUrlToBuffer(image));
  });

  if (request.maskImage) {
    appendMultipartFile(parts, boundary, 'mask', safeUploadFileName('mask', 0, request.maskImage.mimeType), request.maskImage.mimeType, dataUrlToBuffer(request.maskImage));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

function pickImageSource(responseBody: unknown): { imageSource: string; sourceType: 'dataUrl' | 'url' } | null {
  const body = responseBody as { data?: Array<{ b64_json?: string; url?: string }> };
  const first = body.data?.[0];

  if (first?.b64_json) {
    return { imageSource: `data:image/png;base64,${first.b64_json}`, sourceType: 'dataUrl' };
  }

  if (first?.url) {
    return { imageSource: first.url, sourceType: 'url' };
  }

  return null;
}

function responseIndicatesUnsupportedUrlOutput(responseBody: unknown): boolean {
  const serialized = JSON.stringify(responseBody).toLowerCase();
  return serialized.includes('response_format') && (serialized.includes('unsupported') || serialized.includes('unknown') || serialized.includes('invalid'));
}

function createGenerationTimings(requestStartedAt: string, startedAt: number, responseReceivedAt: number, jsonParsedAt: number, requestedUrlOutput: boolean, urlOutputFallback: boolean): GenerateImageTimings {
  return {
    requestStartedAt,
    responseReceivedMs: responseReceivedAt - startedAt,
    jsonParsedMs: jsonParsedAt - responseReceivedAt,
    totalMs: jsonParsedAt - startedAt,
    requestedUrlOutput,
    urlOutputFallback
  };
}

async function callGenerateImageEndpoint(endpoint: string, request: GenerateImageRequest, apiKey: string, includeUrlOutput: boolean) {
  const hasReferenceImages = request.referenceImages.length > 0;
  const requestBody = hasReferenceImages ? createEditMultipartBody(request, includeUrlOutput) : undefined;
  const jsonBody = hasReferenceImages ? undefined : {
    model: request.settings.model,
    prompt: request.prompt,
    size: request.size,
    ...(includeUrlOutput ? { response_format: 'url' } : {})
  };
  const startedAt = Date.now();
  const requestStartedAt = new Date(startedAt).toISOString();

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(requestBody ? { 'Content-Type': requestBody.contentType } : { 'Content-Type': 'application/json' })
    },
    body: requestBody ? new Uint8Array(requestBody.body) : JSON.stringify(jsonBody)
  });
  const responseReceivedAt = Date.now();
  const responseBody = await response.json().catch(() => ({}));
  const jsonParsedAt = Date.now();

  return {
    response,
    responseBody,
    timings: createGenerationTimings(requestStartedAt, startedAt, responseReceivedAt, jsonParsedAt, includeUrlOutput, false)
  };
}
function assertAsciiHeaderValue(name: string, value: string): void {
  if (/[^\x20-\x7e]/.test(value)) {
    throw new Error(`${name} 只能包含英文/数字/ASCII 符号，请检查是否粘贴了中文、全角字符或多余说明文字`);
  }
}

function assertGeneratedImageUrl(url: string): void {
  if (!generatedImageUrls.has(url)) {
    throw new Error('图片下载失败：只允许下载本次生成接口返回的图片地址');
  }
}

function assertImageDataUrl(dataUrl: string): void {
  if (!dataUrl.startsWith('data:image/')) {
    throw new Error('只允许保存已下载完成的图片数据');
  }
}

ipcMain.handle('image:generate', async (_event, request: GenerateImageRequest): Promise<GenerateImageResult> => {
  const apiKey = request.settings.apiKey.trim();
  assertAsciiHeaderValue('API Key', apiKey);

  const hasReferenceImages = request.referenceImages.length > 0;
  const endpoint = `${request.settings.apiBaseUrl.replace(/\/$/, '')}${hasReferenceImages ? '/images/edits' : '/images/generations'}`;
  let generationResult = await callGenerateImageEndpoint(endpoint, request, apiKey, true);

  if (!generationResult.response.ok && responseIndicatesUnsupportedUrlOutput(generationResult.responseBody)) {
    generationResult = await callGenerateImageEndpoint(endpoint, request, apiKey, false);
    generationResult.timings.urlOutputFallback = true;
  }

  const { response, responseBody, timings } = generationResult;

  if (!response.ok) {
    const message = responseBody && typeof responseBody === 'object' && 'error' in responseBody
      ? JSON.stringify((responseBody as { error: unknown }).error)
      : `HTTP ${response.status}`;
    throw new Error(`图片生成失败：${message}`);
  }

  const imageSource = pickImageSource(responseBody);
  if (!imageSource) {
    throw new Error('图片生成失败：响应中没有可用图片数据');
  }

  if (imageSource.sourceType === 'url') {
    generatedImageUrls.add(imageSource.imageSource);
  }

  return { ...imageSource, rawResponse: responseBody, timings };
});


ipcMain.handle('image:download', async (event, url: string, itemId: string): Promise<string> => {
  const sendProgress = (progress: number, bytesReceived: number, totalBytes: number | undefined, bytesPerSecond: number) => {
    event.sender.send('image:download-progress', { itemId, progress, bytesReceived, totalBytes, bytesPerSecond });
  };

  if (url.startsWith('data:')) {
    const bytesReceived = dataUrlToBuffer({ name: 'generated', mimeType: 'image/png', dataUrl: url }).length;
    sendProgress(100, bytesReceived, bytesReceived, bytesReceived);
    return url;
  }

  assertGeneratedImageUrl(url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`图片下载失败：HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? 'image/png';
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  const totalBytes = contentLength > 0 ? contentLength : undefined;
  const startedAt = Date.now();
  const reader = response.body?.getReader();
  if (!reader) {
    const arrayBuffer = await response.arrayBuffer();
    const bytesReceived = arrayBuffer.byteLength;
    const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
    sendProgress(100, bytesReceived, totalBytes ?? bytesReceived, bytesReceived / elapsedSeconds);
    return `data:${contentType};base64,${Buffer.from(arrayBuffer).toString('base64')}`;
  }

  const chunks: Buffer[] = [];
  let receivedLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    const chunk = Buffer.from(value);
    chunks.push(chunk);
    receivedLength += chunk.length;

    const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
    const progress = totalBytes ? Math.min(Math.floor((receivedLength / totalBytes) * 100), 99) : 0;
    sendProgress(progress, receivedLength, totalBytes, receivedLength / elapsedSeconds);
  }

  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
  sendProgress(100, receivedLength, totalBytes ?? receivedLength, receivedLength / elapsedSeconds);
  return `data:${contentType};base64,${Buffer.concat(chunks).toString('base64')}`;
});

ipcMain.handle('image:save', async (_event, dataUrl: string): Promise<{ canceled: boolean; filePath?: string }> => {
  const result = await dialog.showSaveDialog({
    title: '保存生成图片',
    defaultPath: 'gpt-image2-result.png',
    filters: [{ name: 'PNG Image', extensions: ['png'] }]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  assertImageDataUrl(dataUrl);
  const base64 = dataUrl.split(',')[1] ?? '';
  await fs.writeFile(result.filePath, Buffer.from(base64, 'base64'));

  return { canceled: false, filePath: result.filePath };
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
