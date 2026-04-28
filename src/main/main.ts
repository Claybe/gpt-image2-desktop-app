import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { GenerateImageRequest, GenerateImageResult, ImageAsset } from '../shared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 720,
    title: 'GPT Image 2 Studio',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
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

function createEditMultipartBody(request: GenerateImageRequest): { body: Buffer; contentType: string } {
  const boundary = `----gpt-image2-${Date.now().toString(16)}`;
  const parts: Buffer[] = [];

  appendMultipartField(parts, boundary, 'model', request.settings.model);
  appendMultipartField(parts, boundary, 'prompt', request.prompt);
  appendMultipartField(parts, boundary, 'size', request.size);

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

function pickImageDataUrl(responseBody: unknown): string | null {
  const body = responseBody as { data?: Array<{ b64_json?: string; url?: string }> };
  const first = body.data?.[0];

  if (first?.b64_json) {
    return `data:image/png;base64,${first.b64_json}`;
  }

  if (first?.url) {
    return first.url;
  }

  return null;
}

function assertAsciiHeaderValue(name: string, value: string): void {
  if (/[^\x20-\x7e]/.test(value)) {
    throw new Error(`${name} 只能包含英文/数字/ASCII 符号，请检查是否粘贴了中文、全角字符或多余说明文字`);
  }
}

ipcMain.handle('image:generate', async (_event, request: GenerateImageRequest): Promise<GenerateImageResult> => {
  const apiKey = request.settings.apiKey.trim();
  assertAsciiHeaderValue('API Key', apiKey);

  const hasReferenceImages = request.referenceImages.length > 0;
  const endpoint = `${request.settings.apiBaseUrl.replace(/\/$/, '')}${hasReferenceImages ? '/images/edits' : '/images/generations'}`;
  const requestBody = hasReferenceImages ? createEditMultipartBody(request) : undefined;
  const jsonBody = hasReferenceImages ? undefined : {
    model: request.settings.model,
    prompt: request.prompt,
    size: request.size
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(requestBody ? { 'Content-Type': requestBody.contentType } : { 'Content-Type': 'application/json' })
    },
    body: requestBody ? new Uint8Array(requestBody.body) : JSON.stringify(jsonBody)
  });

  const responseBody = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = responseBody && typeof responseBody === 'object' && 'error' in responseBody
      ? JSON.stringify((responseBody as { error: unknown }).error)
      : `HTTP ${response.status}`;
    throw new Error(`图片生成失败：${message}`);
  }

  const imageDataUrl = pickImageDataUrl(responseBody);
  if (!imageDataUrl) {
    throw new Error('图片生成失败：响应中没有可用图片数据');
  }

  return { imageDataUrl, rawResponse: responseBody };
});

ipcMain.handle('image:save', async (_event, dataUrl: string) => {
  const result = await dialog.showSaveDialog({
    title: '保存生成图片',
    defaultPath: 'gpt-image2-result.png',
    filters: [{ name: 'PNG Image', extensions: ['png'] }]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  if (dataUrl.startsWith('data:')) {
    const base64 = dataUrl.split(',')[1] ?? '';
    await fs.writeFile(result.filePath, Buffer.from(base64, 'base64'));
  } else {
    const response = await fetch(dataUrl);
    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(result.filePath, Buffer.from(arrayBuffer));
  }

  return { canceled: false, filePath: result.filePath };
});

app.whenReady().then(createWindow);

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
