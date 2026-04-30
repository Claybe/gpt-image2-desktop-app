import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { GenerateImageProgress, GenerateImageRequest, GenerateImageResult, GenerateImageTimings, ImageAsset } from '../shared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatedImageUrls = new Set<string>();
const IMAGE_DIAGNOSTIC_LOG = 'image-pipeline.jsonl';
const QUEUE_STORAGE_FILE = 'queue.json';

function createDiagnosticEntry(itemId: string, stage: string, details: Record<string, unknown> = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    itemId,
    stage,
    ...details
  });
}

async function writeImageDiagnosticLog(itemId: string, stage: string, details: Record<string, unknown> = {}): Promise<void> {
  const entry = `${createDiagnosticEntry(itemId, stage, details)}\n`;
  const logDirs = [
    path.join(app.getPath('userData'), 'diagnostics'),
    path.join(process.cwd(), 'diagnostics')
  ];

  for (const logDir of logDirs) {
    try {
      await fs.mkdir(logDir, { recursive: true });
      await fs.appendFile(path.join(logDir, IMAGE_DIAGNOSTIC_LOG), entry, 'utf8');
    } catch (error) {
      console.warn('写入图片诊断日志失败', logDir, error);
    }
  }
}

function createSafeRequestLog(request: GenerateImageRequest, endpoint: string, stream: boolean) {
  return {
    endpointPath: new URL(endpoint).pathname,
    model: request.settings.model,
    aspectRatio: request.aspectRatio,
    resolution: request.resolution,
    size: request.size,
    stream,
    referenceImageCount: request.referenceImages.length,
    hasMask: Boolean(request.maskImage),
    promptLength: request.prompt.length,
    promptPreview: request.prompt.slice(0, 80)
  };
}

function getQueueStoragePath(): string {
  return path.join(app.getPath('userData'), QUEUE_STORAGE_FILE);
}

async function loadPersistedQueueFromFile(): Promise<unknown[]> {
  try {
    const content = await fs.readFile(getQueueStoragePath(), 'utf8');
    const queue = JSON.parse(content) as unknown;
    return Array.isArray(queue) ? queue : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('读取队列文件失败', error);
    }
    return [];
  }
}

async function saveQueueToFile(queue: unknown[]): Promise<void> {
  const filePath = getQueueStoragePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(queue), 'utf8');
}

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

function createEditMultipartBody(request: GenerateImageRequest, stream: boolean): { body: Buffer; contentType: string } {
  const boundary = `----gpt-image2-${Date.now().toString(16)}`;
  const parts: Buffer[] = [];

  appendMultipartField(parts, boundary, 'model', request.settings.model);
  appendMultipartField(parts, boundary, 'prompt', request.prompt);
  appendMultipartField(parts, boundary, 'size', request.size);
  if (stream) {
    appendMultipartField(parts, boundary, 'stream', 'true');
    appendMultipartField(parts, boundary, 'partial_images', '3');
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

function isGptImageModel(model: string): boolean {
  return model.toLowerCase().startsWith('gpt-image');
}

function emitGenerationProgress(event: Electron.IpcMainInvokeEvent, progress: GenerateImageProgress): void {
  event.sender.send('image:generation-progress', progress);
}

function getImageDataUrlFromEvent(event: unknown): string | undefined {
  const payload = event as { b64_json?: string; partial_image_b64?: string; url?: string; data?: Array<{ b64_json?: string; url?: string }> };
  const base64 = payload.b64_json ?? payload.partial_image_b64 ?? payload.data?.[0]?.b64_json;
  if (base64) {
    return `data:image/png;base64,${base64}`;
  }

  return payload.url ?? payload.data?.[0]?.url;
}

function parseSseDataChunks(buffer: string): { chunks: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const rest = parts.pop() ?? '';
  const chunks = parts
    .map((part) => part.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n').trim())
    .filter(Boolean);

  return { chunks, rest };
}

function parseImageStreamEvent(data: string): unknown | undefined {
  if (data === '[DONE]') {
    return undefined;
  }

  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

function isPartialImageEvent(event: unknown): boolean {
  const type = String((event as { type?: string }).type ?? '').toLowerCase();
  return type.includes('partial');
}

function isCompletedImageEvent(event: unknown): boolean {
  const type = String((event as { type?: string }).type ?? '').toLowerCase();
  return type.includes('completed') || type.includes('done');
}

function streamRejected(responseBody: unknown): boolean {
  const serialized = JSON.stringify(responseBody).toLowerCase();
  return serialized.includes('stream') && (serialized.includes('unsupported') || serialized.includes('unknown') || serialized.includes('invalid'));
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

async function callGenerateImageEndpoint(endpoint: string, request: GenerateImageRequest, apiKey: string, stream: boolean) {
  const hasReferenceImages = request.referenceImages.length > 0;
  const requestBody = hasReferenceImages ? createEditMultipartBody(request, stream) : undefined;
  const jsonBody = hasReferenceImages ? undefined : {
    model: request.settings.model,
    prompt: request.prompt,
    size: request.size,
    ...(stream ? { stream: true, partial_images: 3 } : {})
  };
  const startedAt = Date.now();
  const requestStartedAt = new Date(startedAt).toISOString();
  void writeImageDiagnosticLog(request.itemId ?? 'unknown', 'generate.fetch.start', createSafeRequestLog(request, endpoint, stream));

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(requestBody ? { 'Content-Type': requestBody.contentType } : { 'Content-Type': 'application/json' })
    },
    body: requestBody ? new Uint8Array(requestBody.body) : JSON.stringify(jsonBody)
  });
  const responseReceivedAt = Date.now();
  void writeImageDiagnosticLog(request.itemId ?? 'unknown', 'generate.fetch.response', {
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length'),
    responseReceivedMs: responseReceivedAt - startedAt
  });

  return {
    response,
    responseReceivedAt,
    startedAt,
    requestStartedAt
  };
}

async function readJsonGenerateResponse(itemId: string, result: Awaited<ReturnType<typeof callGenerateImageEndpoint>>, requestedStream: boolean) {
  const responseBody = await result.response.json().catch(() => ({}));
  const jsonParsedAt = Date.now();
  const imageSource = pickImageSource(responseBody);
  void writeImageDiagnosticLog(itemId, 'generate.json.parsed', {
    status: result.response.status,
    jsonParsedMs: jsonParsedAt - result.responseReceivedAt,
    totalMs: jsonParsedAt - result.startedAt,
    hasImage: Boolean(imageSource),
    imageSourceType: imageSource?.sourceType,
    fallbackFromStream: requestedStream
  });

  return {
    response: result.response,
    responseBody,
    timings: createGenerationTimings(result.requestStartedAt, result.startedAt, result.responseReceivedAt, jsonParsedAt, false, requestedStream)
  };
}

async function readStreamGenerateResponse(event: Electron.IpcMainInvokeEvent, itemId: string, result: Awaited<ReturnType<typeof callGenerateImageEndpoint>>) {
  const reader = result.response.body?.getReader();
  if (!reader) {
    void writeImageDiagnosticLog(itemId, 'generate.stream.no_reader', { status: result.response.status });
    return readJsonGenerateResponse(itemId, result, true);
  }

  const decoder = new TextDecoder();
  const events: unknown[] = [];
  let buffer = '';
  let partialImageCount = 0;
  let streamByteCount = 0;
  let finalImageSource: { imageSource: string; sourceType: 'dataUrl' | 'url' } | undefined;
  let latestImageSource: { imageSource: string; sourceType: 'dataUrl' | 'url' } | undefined;

  void writeImageDiagnosticLog(itemId, 'generate.stream.start', {
    status: result.response.status,
    responseReceivedMs: result.responseReceivedAt - result.startedAt
  });
  emitGenerationProgress(event, {
    itemId,
    type: 'stream_started',
    message: `API 已响应，开始接收流式生成事件 · 首次响应 ${((result.responseReceivedAt - result.startedAt) / 1000).toFixed(1)} 秒`,
    elapsedMs: result.responseReceivedAt - result.startedAt
  });

  while (true) {
    const { done, value } = await reader.read();
    streamByteCount += value?.byteLength ?? 0;
    buffer += value ? decoder.decode(value, { stream: !done }) : '';
    const parsed = parseSseDataChunks(buffer);
    buffer = parsed.rest;

    for (const data of parsed.chunks) {
      const streamEvent = parseImageStreamEvent(data);
      if (!streamEvent) {
        void writeImageDiagnosticLog(itemId, 'generate.stream.unparsed_event', { bytes: data.length });
        continue;
      }

      events.push(streamEvent);
      const eventType = String((streamEvent as { type?: string }).type ?? 'unknown');
      const imageSource = getImageDataUrlFromEvent(streamEvent);
      if (imageSource) {
        latestImageSource = {
          imageSource,
          sourceType: imageSource.startsWith('data:') ? 'dataUrl' : 'url'
        };
      }
      const elapsedMs = Date.now() - result.startedAt;
      void writeImageDiagnosticLog(itemId, 'generate.stream.event', {
        eventType,
        eventIndex: events.length,
        elapsedMs,
        hasImage: Boolean(imageSource),
        partialImageCount,
        streamByteCount
      });
      emitGenerationProgress(event, {
        itemId,
        type: 'stream_event',
        message: `流式事件 ${events.length}：${eventType} · 生成中 ${(elapsedMs / 1000).toFixed(1)} 秒 · 已接收 ${(streamByteCount / 1024 / 1024).toFixed(1)} MB`,
        eventIndex: events.length,
        elapsedMs,
        streamBytes: streamByteCount
      });

      if (imageSource && isPartialImageEvent(streamEvent)) {
        partialImageCount += 1;
        void writeImageDiagnosticLog(itemId, 'generate.stream.partial_image', {
          partialImageCount,
          elapsedMs: Date.now() - result.startedAt,
          imageSourceType: imageSource.startsWith('data:') ? 'dataUrl' : 'url'
        });
        emitGenerationProgress(event, {
          itemId,
          type: 'partial_image',
          message: `收到第 ${partialImageCount} 张生成草稿 · ${((Date.now() - result.startedAt) / 1000).toFixed(1)} 秒`,
          partialImageIndex: partialImageCount,
          elapsedMs: Date.now() - result.startedAt,
          streamBytes: streamByteCount,
          imageDataUrl: imageSource
        });
      }

      if (imageSource && isCompletedImageEvent(streamEvent)) {
        finalImageSource = {
          imageSource,
          sourceType: imageSource.startsWith('data:') ? 'dataUrl' : 'url'
        };
        void writeImageDiagnosticLog(itemId, 'generate.stream.completed_event', {
          elapsedMs: Date.now() - result.startedAt,
          imageSourceType: finalImageSource.sourceType,
          partialImageCount
        });
        emitGenerationProgress(event, { itemId, type: 'completed', message: `生成完成 · ${((Date.now() - result.startedAt) / 1000).toFixed(1)} 秒 · 共 ${partialImageCount} 张草稿`, elapsedMs: Date.now() - result.startedAt, streamBytes: streamByteCount, imageDataUrl: imageSource });
      }
    }

    if (done) {
      break;
    }
  }

  const jsonParsedAt = Date.now();
  void writeImageDiagnosticLog(itemId, 'generate.stream.end', {
    totalMs: jsonParsedAt - result.startedAt,
    streamReadMs: jsonParsedAt - result.responseReceivedAt,
    eventCount: events.length,
    partialImageCount,
    streamByteCount,
    hasFinalImage: Boolean(finalImageSource)
  });

  const imageSourceForResponse = finalImageSource ?? latestImageSource;
  if (!finalImageSource && latestImageSource) {
    void writeImageDiagnosticLog(itemId, 'generate.stream.latest_stream_image_not_completed_fallback', {
      totalMs: jsonParsedAt - result.startedAt,
      eventCount: events.length,
      partialImageCount,
      streamByteCount,
      fallbackSource: 'latest_stream_image_not_completed',
      imageSourceType: latestImageSource.sourceType
    });
    emitGenerationProgress(event, {
      itemId,
      type: 'fallback',
      message: `未收到最终完成图片，已使用最后一张流式中间/草稿图片 · ${((jsonParsedAt - result.startedAt) / 1000).toFixed(1)} 秒`,
      elapsedMs: jsonParsedAt - result.startedAt,
      streamBytes: streamByteCount,
      imageDataUrl: latestImageSource.imageSource
    });
  }

  return {
    response: result.response,
    responseBody: { data: imageSourceForResponse ? [{ b64_json: imageSourceForResponse.sourceType === 'dataUrl' ? imageSourceForResponse.imageSource.split(',')[1] : undefined, url: imageSourceForResponse.sourceType === 'url' ? imageSourceForResponse.imageSource : undefined }] : [], events, streamFallbackReason: finalImageSource ? undefined : latestImageSource ? 'latest_stream_image_not_completed' : 'no_image' },
    timings: createGenerationTimings(result.requestStartedAt, result.startedAt, result.responseReceivedAt, jsonParsedAt, false, false)
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

ipcMain.handle('queue:load', async (): Promise<unknown[]> => {
  return loadPersistedQueueFromFile();
});

ipcMain.handle('queue:save', async (_event, queue: unknown[]): Promise<void> => {
  await saveQueueToFile(Array.isArray(queue) ? queue : []);
});

ipcMain.handle('image:generate', async (event, request: GenerateImageRequest): Promise<GenerateImageResult> => {
  const apiKey = request.settings.apiKey.trim();
  assertAsciiHeaderValue('API Key', apiKey);

  const hasReferenceImages = request.referenceImages.length > 0;
  const itemId = request.itemId ?? crypto.randomUUID();
  const endpoint = `${request.settings.apiBaseUrl.replace(/\/$/, '')}${hasReferenceImages ? '/images/edits' : '/images/generations'}`;
  const shouldStream = isGptImageModel(request.settings.model);
  request.itemId = itemId;
  void writeImageDiagnosticLog(itemId, 'generate.handle.start', {
    model: request.settings.model,
    shouldStream,
    hasReferenceImages,
    hasMask: Boolean(request.maskImage)
  });
  emitGenerationProgress(event, { itemId, type: 'request_started', message: shouldStream ? '请求已发送，等待 API 接收并开始流式生成' : '请求已发送，等待 API 返回生成结果' });

  let generationResult = await callGenerateImageEndpoint(endpoint, request, apiKey, shouldStream);
  let parsedResult = shouldStream && generationResult.response.ok
    ? await readStreamGenerateResponse(event, itemId, generationResult)
    : await readJsonGenerateResponse(itemId, generationResult, false);

  if (shouldStream && ((!parsedResult.response.ok && streamRejected(parsedResult.responseBody)) || (parsedResult.response.ok && !pickImageSource(parsedResult.responseBody)))) {
    const reason = parsedResult.response.ok ? '流式响应未包含可用图片，已回退普通生成' : '当前接口不支持流式生成，已回退普通生成';
    emitGenerationProgress(event, { itemId, type: 'fallback', message: reason });
    void writeImageDiagnosticLog(itemId, 'generate.handle.stream_fallback', {
      reason,
      status: parsedResult.response.status,
      hadImage: Boolean(pickImageSource(parsedResult.responseBody))
    });
    generationResult = await callGenerateImageEndpoint(endpoint, request, apiKey, false);
    parsedResult = await readJsonGenerateResponse(itemId, generationResult, true);
  }

  const { response, responseBody, timings } = parsedResult;

  if (!response.ok) {
    const message = responseBody && typeof responseBody === 'object' && 'error' in responseBody
      ? JSON.stringify((responseBody as { error: unknown }).error)
      : `HTTP ${response.status}`;
    void writeImageDiagnosticLog(itemId, 'generate.handle.error', {
      status: response.status,
      message,
      totalMs: timings.totalMs
    });
    throw new Error(`图片生成失败：${message}`);
  }

  const imageSource = pickImageSource(responseBody);
  if (!imageSource) {
    const body = responseBody as { events?: unknown[] };
    void writeImageDiagnosticLog(itemId, 'generate.handle.no_image', {
      totalMs: timings.totalMs,
      eventCount: body.events?.length ?? 0
    });
    throw new Error('图片生成失败：响应中没有可用图片数据。可能是流式响应未返回最终图、代理返回空 data，或连接在最终图片事件前中断。');
  }

  if (imageSource.sourceType === 'url') {
    generatedImageUrls.add(imageSource.imageSource);
  }

  void writeImageDiagnosticLog(itemId, 'generate.handle.success', {
    imageSourceType: imageSource.sourceType,
    streamFallbackReason: (responseBody as { streamFallbackReason?: string }).streamFallbackReason,
    totalMs: timings.totalMs,
    responseReceivedMs: timings.responseReceivedMs,
    parseOrStreamMs: timings.jsonParsedMs,
    fallbackFromStream: timings.urlOutputFallback
  });

  return { ...imageSource, rawResponse: responseBody, timings };
});


ipcMain.handle('image:download', async (event, url: string, itemId: string): Promise<string> => {
  const downloadStartedAt = Date.now();
  const sendProgress = (progress: number, bytesReceived: number, totalBytes: number | undefined, bytesPerSecond: number) => {
    event.sender.send('image:download-progress', { itemId, progress, bytesReceived, totalBytes, bytesPerSecond });
  };

  void writeImageDiagnosticLog(itemId, 'download.start', {
    sourceType: url.startsWith('data:') ? 'dataUrl' : 'url'
  });

  if (url.startsWith('data:')) {
    const bytesReceived = dataUrlToBuffer({ name: 'generated', mimeType: 'image/png', dataUrl: url }).length;
    sendProgress(100, bytesReceived, bytesReceived, bytesReceived);
    void writeImageDiagnosticLog(itemId, 'download.data_url.complete', {
      bytesReceived,
      totalMs: Date.now() - downloadStartedAt
    });
    return url;
  }

  assertGeneratedImageUrl(url);
  const response = await fetch(url);
  void writeImageDiagnosticLog(itemId, 'download.fetch.response', {
    status: response.status,
    ok: response.ok,
    responseReceivedMs: Date.now() - downloadStartedAt,
    contentType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length')
  });
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
    void writeImageDiagnosticLog(itemId, 'download.array_buffer.complete', {
      bytesReceived,
      totalMs: Date.now() - downloadStartedAt,
      bytesPerSecond: bytesReceived / elapsedSeconds
    });
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
  void writeImageDiagnosticLog(itemId, 'download.stream.complete', {
    bytesReceived: receivedLength,
    totalBytes: totalBytes ?? receivedLength,
    totalMs: Date.now() - downloadStartedAt,
    bytesPerSecond: receivedLength / elapsedSeconds
  });
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
