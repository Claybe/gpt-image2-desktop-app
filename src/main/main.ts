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
      preload: path.join(__dirname, '../preload/preload.js'),
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

function dataUrlToBlob(asset: ImageAsset): Blob {
  const base64 = asset.dataUrl.split(',')[1] ?? '';
  const bytes = Buffer.from(base64, 'base64');
  return new Blob([bytes], { type: asset.mimeType });
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

ipcMain.handle('image:generate', async (_event, request: GenerateImageRequest): Promise<GenerateImageResult> => {
  const hasReferenceImages = request.referenceImages.length > 0;
  const endpoint = `${request.settings.apiBaseUrl.replace(/\/$/, '')}${hasReferenceImages ? '/images/edits' : '/images/generations'}`;
  const body = hasReferenceImages ? new FormData() : {
    model: request.settings.model,
    prompt: request.prompt,
    size: request.size
  };

  if (body instanceof FormData) {
    body.set('model', request.settings.model);
    body.set('prompt', request.prompt);
    body.set('size', request.size);

    request.referenceImages.forEach((image, index) => {
      body.append('image', dataUrlToBlob(image), image.name || `reference-${index + 1}.png`);
    });

    if (request.maskImage) {
      body.set('mask', dataUrlToBlob(request.maskImage), request.maskImage.name || 'mask.png');
    }
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${request.settings.apiKey}`,
      ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' })
    },
    body: body instanceof FormData ? body : JSON.stringify(body)
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
