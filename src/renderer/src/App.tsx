import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppSettings, GenerateImageProgress, GenerateImageRequest, ImageAsset, ImageSize, MaskMode } from '../../shared.js';
import './styles.css';

const DEFAULT_SETTINGS: AppSettings = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-image-2'
};

const IMAGE_SIZES: ImageSize[] = ['1024x1024', '1024x1536', '1536x1024', 'auto'];
const QUEUE_STORAGE_KEY = 'gpt-image2-queue';
const MAX_QUEUE_STORAGE_CHARS = 5_000_000;
const MAX_PERSISTED_QUEUE_ITEMS = 50;

type BrushMode = 'draw' | 'erase';
type QueueStatus = 'generating' | 'downloading' | 'done' | 'failed';
type ImageLoadStatus = 'loading' | 'loaded' | 'failed';

interface QueueItem {
  id: string;
  prompt: string;
  size: ImageSize;
  referenceImages: ImageAsset[];
  maskImage?: ImageAsset;
  maskSourceDataUrl?: string;
  maskMode?: MaskMode;
  parentTaskId?: string;
  status: QueueStatus;
  createdAt: string;
  error?: string;
  generationPreviewImage?: string;
  generationStage?: string;
  generationPartialCount?: number;
  resultImage?: string;
  imageLoadStatus?: ImageLoadStatus;
  imageDownloadProgress?: number;
  imageDownloadSpeed?: number;
  generatedSeconds: number;
  downloadSeconds: number;
  elapsedSeconds: number;
}

interface LogEntry {
  id: string;
  level: 'info' | 'error';
  message: string;
  timestamp: string;
}

function readFileAsAsset(file: File): Promise<ImageAsset> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, mimeType: file.type || 'image/png', dataUrl: String(reader.result) });
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`));
    reader.readAsDataURL(file);
  });
}

function formatClock(date = new Date()) {
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function formatDuration(seconds: number) {
  const normalizedSeconds = Number.isFinite(seconds) ? Math.max(seconds, 0) : 0;
  if (normalizedSeconds > 0 && normalizedSeconds < 1) {
    return `${normalizedSeconds.toFixed(1)}秒`;
  }

  const wholeSeconds = Math.floor(normalizedSeconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const restSeconds = wholeSeconds % 60;
  return minutes > 0 ? `${minutes}分${restSeconds}秒` : `${restSeconds}秒`;
}

function formatMilliseconds(milliseconds: number) {
  const normalizedMilliseconds = Number.isFinite(milliseconds) ? Math.max(milliseconds, 0) : 0;
  return `${(normalizedMilliseconds / 1000).toFixed(2)}秒`;
}

function formatSpeed(bytesPerSecond = 0) {
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
  }

  if (bytesPerSecond >= 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  }

  return `${Math.round(bytesPerSecond)} B/s`;
}

function formatTaskDurations(item: QueueItem) {
  if (item.status === 'generating') {
    return `生成 ${formatDuration(item.generatedSeconds || item.elapsedSeconds)}`;
  }

  if (item.status === 'downloading') {
    return `下载图片 ${item.imageDownloadProgress ?? 0}% · ${formatSpeed(item.imageDownloadSpeed)}`;
  }

  if (item.status === 'done') {
    return `生成 ${formatDuration(item.generatedSeconds || item.elapsedSeconds)}`;
  }

  return `生成 ${formatDuration(item.generatedSeconds || item.elapsedSeconds)}`;
}

function getGenerationStageText(seconds: number) {
  const normalizedSeconds = Number.isFinite(seconds) ? Math.max(seconds, 0) : 0;
  if (normalizedSeconds < 10) {
    return '请求已发送，等待 API 接收';
  }

  if (normalizedSeconds < 45) {
    return 'API 已接收请求，服务端准备生成';
  }

  if (normalizedSeconds < 90) {
    return '服务端排队或模型生成中，等待首个流式事件';
  }

  return '生成仍在进行，等待服务端返回草稿或完成事件';
}

function formatQueueActivity(item: QueueItem) {
  if (item.status === 'generating') {
    return `${item.generationStage ?? getGenerationStageText(item.generatedSeconds || item.elapsedSeconds)} · ${formatTaskDurations(item)}`;
  }

  if (item.status === 'downloading') {
    return `下载图片 ${item.imageDownloadProgress ?? 0}% · ${formatSpeed(item.imageDownloadSpeed)}`;
  }

  if (item.status === 'failed') {
    return `失败 · ${formatTaskDurations(item)}`;
  }

  return `已完成 · ${formatTaskDurations(item)}`;
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('遮罩图片加载失败'));
    image.src = dataUrl;
  });
}

async function createMaskAsset(dataUrl: string, mode: MaskMode): Promise<ImageAsset> {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('无法处理遮罩图片');
  }

  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < pixels.data.length; index += 4) {
    const alpha = pixels.data[index + 3];
    const gray = Math.round(((pixels.data[index] + pixels.data[index + 1] + pixels.data[index + 2]) / 3) * (alpha / 255));

    if (mode === 'alpha') {
      pixels.data[index] = 255;
      pixels.data[index + 1] = 255;
      pixels.data[index + 2] = 255;
      pixels.data[index + 3] = 255 - alpha;
    } else {
      const value = mode === 'invert-gray' ? 255 - gray : gray;
      pixels.data[index] = value;
      pixels.data[index + 1] = value;
      pixels.data[index + 2] = value;
      pixels.data[index + 3] = 255;
    }
  }

  context.putImageData(pixels, 0, 0);
  return { name: `mask-${mode}.png`, mimeType: 'image/png', dataUrl: canvas.toDataURL('image/png') };
}

function normalizeQueueItem(item: Partial<QueueItem>): QueueItem {
  const status = item.status === 'done' || item.status === 'failed' || item.status === 'generating' || item.status === 'downloading' ? item.status : 'failed';
  return {
    id: item.id ?? crypto.randomUUID(),
    prompt: item.prompt ?? '',
    size: item.size ?? '1024x1024',
    referenceImages: item.referenceImages ?? [],
    maskImage: item.maskImage,
    maskSourceDataUrl: item.maskSourceDataUrl,
    maskMode: item.maskMode,
    parentTaskId: item.parentTaskId,
    status: status === 'generating' || status === 'downloading' ? 'failed' : status,
    createdAt: item.createdAt ?? formatClock(),
    error: status === 'generating' || status === 'downloading' ? '应用重启后任务已停止，请重新生成' : item.error,
    generationPreviewImage: item.generationPreviewImage,
    generationStage: item.generationStage,
    generationPartialCount: item.generationPartialCount ?? 0,
    resultImage: item.resultImage,
    imageLoadStatus: item.resultImage ? (item.imageLoadStatus === 'failed' ? 'failed' : 'loaded') : undefined,
    imageDownloadProgress: typeof item.imageDownloadProgress === 'number' ? item.imageDownloadProgress : (item.resultImage ? 100 : undefined),
    imageDownloadSpeed: typeof item.imageDownloadSpeed === 'number' ? item.imageDownloadSpeed : 0,
    generatedSeconds: item.generatedSeconds ?? item.elapsedSeconds ?? 0,
    downloadSeconds: item.downloadSeconds ?? 0,
    elapsedSeconds: item.elapsedSeconds ?? ((item.generatedSeconds ?? 0) + (item.downloadSeconds ?? 0))
  };
}

function serializeQueueForStorage(queue: QueueItem[]): string {
  let persistedQueue = queue.slice(-MAX_PERSISTED_QUEUE_ITEMS);
  let serialized = JSON.stringify(persistedQueue);

  while (serialized.length > MAX_QUEUE_STORAGE_CHARS && persistedQueue.length > 0) {
    persistedQueue = persistedQueue.slice(1);
    serialized = JSON.stringify(persistedQueue);
  }

  return serialized;
}

function loadPersistedQueue(): QueueItem[] {
  const saved = localStorage.getItem(QUEUE_STORAGE_KEY);
  if (!saved) {
    return [];
  }

  try {
    const parsed = JSON.parse(saved) as Array<Partial<QueueItem>>;
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(QUEUE_STORAGE_KEY);
      return [];
    }

    return parsed.map(normalizeQueueItem);
  } catch {
    localStorage.removeItem(QUEUE_STORAGE_KEY);
    return [];
  }
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const queueListRef = useRef<HTMLDivElement | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const timersRef = useRef<Record<string, number>>({});
  const startTimesRef = useRef<Record<string, number>>({});
  const downloadTimersRef = useRef<Record<string, number>>({});
  const downloadStartTimesRef = useRef<Record<string, number>>({});
  const queueStorageReadyRef = useRef(false);
  const queueSaveTimerRef = useRef<number | undefined>(undefined);
  const selectedQueueItemIdRef = useRef<string | undefined>(undefined);
  const pendingMaskDataUrlRef = useRef<string | undefined>(undefined);
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('gpt-image2-settings');
    if (!saved) {
      return DEFAULT_SETTINGS;
    }

    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch {
      localStorage.removeItem('gpt-image2-settings');
      return DEFAULT_SETTINGS;
    }
  });
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<ImageSize>('1024x1024');
  const [referenceImages, setReferenceImages] = useState<ImageAsset[]>([]);
  const [selectedReferenceIndex, setSelectedReferenceIndex] = useState(0);
  const [brushSize, setBrushSize] = useState(36);
  const [brushMode, setBrushMode] = useState<BrushMode>('draw');
  const [maskMode, setMaskMode] = useState<MaskMode>('alpha');
  const [contextSourceTaskId, setContextSourceTaskId] = useState<string>();
  const [isDrawing, setIsDrawing] = useState(false);
  const [maskDataUrl, setMaskDataUrl] = useState<string>();
  const [resultImage, setResultImage] = useState<string>();
  const [resultImageStatus, setResultImageStatus] = useState<ImageLoadStatus>();
  const [status, setStatus] = useState('准备就绪');
  const [queue, setQueueState] = useState<QueueItem[]>(loadPersistedQueue);
  const [selectedQueueItemId, setSelectedQueueItemId] = useState<string>();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [previewImage, setPreviewImage] = useState<string>();
  const [isQueueSelecting, setIsQueueSelecting] = useState(false);
  const [selectedQueueIds, setSelectedQueueIds] = useState<string[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  queueRef.current = queue;
  selectedQueueItemIdRef.current = selectedQueueItemId;

  const selectedReference = referenceImages[selectedReferenceIndex];
  const selectedQueueItem = queue.find((item) => item.id === selectedQueueItemId);
  const generatingCount = queue.filter((item) => item.status === 'generating').length;
  const contextResultItems = useMemo(() => {
    if (!selectedQueueItem) {
      return [];
    }

    const byId = new Map(queue.map((item) => [item.id, item]));
    const ancestors: QueueItem[] = [];
    let current = selectedQueueItem.parentTaskId ? byId.get(selectedQueueItem.parentTaskId) : undefined;

    while (current) {
      ancestors.unshift(current);
      current = current.parentTaskId ? byId.get(current.parentTaskId) : undefined;
    }

    const descendants: QueueItem[] = [];
    let child = queue.find((item) => item.parentTaskId === selectedQueueItem.id);
    while (child) {
      descendants.push(child);
      child = queue.find((item) => item.parentTaskId === child?.id);
    }

    return [...ancestors, selectedQueueItem, ...descendants].filter((item) => item.resultImage);
  }, [queue, selectedQueueItem]);
  const selectedContextResultIndex = selectedQueueItemId ? contextResultItems.findIndex((item) => item.id === selectedQueueItemId) : -1;

  const canSubmit = useMemo(() => true, []);

  function setQueue(updater: (current: QueueItem[]) => QueueItem[]) {
    const next = updater(queueRef.current);
    queueRef.current = next;
    setQueueState(next);
  }

  useEffect(() => {
    localStorage.setItem('gpt-image2-settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    let isMounted = true;

    async function loadQueueFromFile() {
      let loadedFromFile = false;

      try {
        const persistedQueue = await window.desktopApi?.loadQueue?.();
        if (!isMounted) {
          return;
        }

        if (Array.isArray(persistedQueue) && persistedQueue.length > 0) {
          const normalizedQueue = persistedQueue.map((item) => normalizeQueueItem(item as Partial<QueueItem>));
          queueRef.current = normalizedQueue;
          setQueueState(normalizedQueue);
          loadedFromFile = true;
        }
      } catch (error) {
        addLog('error', `读取队列文件失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (isMounted) {
          queueStorageReadyRef.current = true;
          if (!loadedFromFile && queueRef.current.length > 0) {
            void window.desktopApi?.saveQueue?.(queueRef.current).catch((error) => {
              addLog('error', `迁移队列文件失败：${error instanceof Error ? error.message : String(error)}`);
            });
          }
        }
      }
    }

    void loadQueueFromFile();

    return () => {
      isMounted = false;
      if (queueSaveTimerRef.current) {
        window.clearTimeout(queueSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, serializeQueueForStorage(queue));
    } catch {
      localStorage.removeItem(QUEUE_STORAGE_KEY);
    }

    if (!queueStorageReadyRef.current) {
      return;
    }

    if (queueSaveTimerRef.current) {
      window.clearTimeout(queueSaveTimerRef.current);
    }

    queueSaveTimerRef.current = window.setTimeout(() => {
      const queueToSave = queueRef.current;
      void window.desktopApi?.saveQueue?.(queueToSave).catch((error) => {
        addLog('error', `保存队列文件失败：${error instanceof Error ? error.message : String(error)}`);
      });
    }, 300);
  }, [queue]);

  useEffect(() => {
    const unsubscribeGenerationProgress = window.desktopApi?.onImageGenerationProgress?.((progress) => {
      updateQueueGenerationProgress(progress);
    });
    const unsubscribeDownloadProgress = window.desktopApi?.onImageDownloadProgress?.(({ itemId, progress, bytesPerSecond }) => {
      updateQueueDownloadProgress(itemId, progress, bytesPerSecond);
    });

    return () => {
      unsubscribeGenerationProgress?.();
      unsubscribeDownloadProgress?.();
      Object.values(timersRef.current).forEach((timer) => window.clearInterval(timer));
      Object.values(downloadTimersRef.current).forEach((timer) => window.clearInterval(timer));
    };
  }, []);

  useEffect(() => {
    if (!selectedQueueItemId) {
      return;
    }

    queueListRef.current?.querySelector(`[data-queue-id="${selectedQueueItemId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedQueueItemId]);

  useEffect(() => {
    if (!selectedReference || !canvasRef.current) {
      return;
    }

    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context?.clearRect(0, 0, canvas.width, canvas.height);

      const pendingMaskDataUrl = pendingMaskDataUrlRef.current;
      pendingMaskDataUrlRef.current = undefined;
      if (pendingMaskDataUrl) {
        loadImage(pendingMaskDataUrl).then((maskImage) => {
          if (canvasRef.current !== canvas) {
            return;
          }

          context?.drawImage(maskImage, 0, 0, canvas.width, canvas.height);
          setMaskDataUrl(canvas.toDataURL('image/png'));
        }).catch((error) => {
          const message = error instanceof Error ? error.message : '遮罩图片加载失败';
          setStatus(message);
          addLog('error', message);
        });
      } else {
        setMaskDataUrl(undefined);
      }
    };
    image.src = selectedReference.dataUrl;
    imageRef.current = image;
  }, [selectedReference]);

  function addLog(level: LogEntry['level'], message: string) {
    setLogs((current) => [{ id: crypto.randomUUID(), level, message, timestamp: formatClock() }, ...current].slice(0, 80));
  }

  function validateInput() {
    if (!settings.apiKey.trim()) {
      return '请填写 API Key';
    }

    if (/[^\x20-\x7e]/.test(settings.apiKey.trim())) {
      return 'API Key 只能包含英文/数字/ASCII 符号，请检查是否粘贴了中文、全角字符或多余说明文字';
    }

    if (!prompt.trim()) {
      return '请填写提示词';
    }

    if (!window.desktopApi) {
      return '桌面桥接未加载，请使用 npm run dev 启动 Electron 应用，不要直接打开浏览器页面';
    }

    return undefined;
  }

  async function snapshotQueueItem(): Promise<QueueItem> {
    return {
      id: crypto.randomUUID(),
      prompt,
      size,
      referenceImages: [...referenceImages],
      maskImage: maskDataUrl ? await createMaskAsset(maskDataUrl, maskMode) : undefined,
      maskSourceDataUrl: maskDataUrl,
      maskMode,
      parentTaskId: contextSourceTaskId,
      status: 'generating',
      createdAt: formatClock(),
      generatedSeconds: 0,
      downloadSeconds: 0,
      elapsedSeconds: 0
    };
  }

  async function runQueueItem(item: QueueItem) {
    if (!window.desktopApi) {
      throw new Error('桌面桥接未加载，请使用 npm run dev 启动 Electron 应用，不要直接打开浏览器页面');
    }

    const request: GenerateImageRequest = {
      itemId: item.id,
      settings,
      prompt: item.prompt,
      size: item.size,
      referenceImages: item.referenceImages ?? [],
      maskImage: item.maskImage,
      maskMode: item.maskMode
    };
    return window.desktopApi.generateImage(request);
  }

  function startTaskTimer(itemId: string, promptText: string) {
    startTimesRef.current[itemId] = Date.now();
    setStatus(`请求已发送，等待 API 接收：${promptText.slice(0, 24)}`);
    timersRef.current[itemId] = window.setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startTimesRef.current[itemId]) / 1000);
      const stageText = getGenerationStageText(elapsedSeconds);
      setQueue((current) => current.map((item) => item.id === itemId ? { ...item, elapsedSeconds } : item));
      if (selectedQueueItemIdRef.current === itemId) {
        setStatus(`${stageText}：${promptText.slice(0, 24)} · ${formatDuration(elapsedSeconds)}`);
      }
    }, 1000);
  }

  function stopTaskTimer(itemId: string) {
    const startedAt = startTimesRef.current[itemId] ?? Date.now();
    const elapsedSeconds = Math.max(Math.floor((Date.now() - startedAt) / 1000), 0);
    if (timersRef.current[itemId]) {
      window.clearInterval(timersRef.current[itemId]);
      delete timersRef.current[itemId];
    }

    delete startTimesRef.current[itemId];
    return elapsedSeconds;
  }

  function startDownloadTimer(itemId: string) {
    downloadStartTimesRef.current[itemId] = Date.now();
    downloadTimersRef.current[itemId] = window.setInterval(() => {
      const downloadSeconds = Math.max((Date.now() - downloadStartTimesRef.current[itemId]) / 1000, 0.1);
      setQueue((current) => current.map((item) => item.id === itemId ? { ...item, downloadSeconds, elapsedSeconds: item.generatedSeconds + downloadSeconds } : item));
    }, 200);
  }

  function stopDownloadTimer(itemId: string) {
    const downloadSeconds = Math.max((Date.now() - downloadStartTimesRef.current[itemId]) / 1000, 0.1);
    if (downloadTimersRef.current[itemId]) {
      window.clearInterval(downloadTimersRef.current[itemId]);
      delete downloadTimersRef.current[itemId];
    }

    delete downloadStartTimesRef.current[itemId];
    return downloadSeconds;
  }

  function updateQueueGenerationProgress(progress: GenerateImageProgress) {
    setQueue((current) => current.map((queueItem) => {
      if (queueItem.id !== progress.itemId) {
        return queueItem;
      }

      return {
        ...queueItem,
        generationStage: progress.message,
        generationPreviewImage: progress.imageDataUrl ?? queueItem.generationPreviewImage,
        generationPartialCount: progress.partialImageIndex ?? queueItem.generationPartialCount ?? 0
      };
    }));

    if (selectedQueueItemIdRef.current === progress.itemId) {
      if (progress.imageDataUrl) {
        setResultImage(progress.imageDataUrl);
        setResultImageStatus('loading');
      }
      setStatus(progress.message);
    }

    if (progress.type === 'partial_image' || progress.type === 'fallback') {
      addLog('info', progress.message);
    }
  }

  function updateQueueDownloadProgress(itemId: string, progress: number, bytesPerSecond = 0) {
    const downloadSeconds = downloadStartTimesRef.current[itemId] ? Math.max((Date.now() - downloadStartTimesRef.current[itemId]) / 1000, 0.1) : undefined;
    setQueue((current) => current.map((queueItem) => {
      if (queueItem.id !== itemId) {
        return queueItem;
      }

      return {
        ...queueItem,
        imageDownloadProgress: progress,
        imageDownloadSpeed: bytesPerSecond,
        downloadSeconds: downloadSeconds ?? queueItem.downloadSeconds,
        elapsedSeconds: queueItem.generatedSeconds + (downloadSeconds ?? queueItem.downloadSeconds)
      };
    }));
  }

  function updateQueueImageLoadStatus(itemId: string, imageLoadStatus: ImageLoadStatus) {
    setQueue((current) => current.map((queueItem) => {
      if (queueItem.id !== itemId) {
        return queueItem;
      }

      if (queueItem.status === 'done' && queueItem.imageLoadStatus === 'loaded') {
        return queueItem;
      }

      if (imageLoadStatus === 'loaded') {
        return { ...queueItem, status: 'done', imageLoadStatus, imageDownloadProgress: 100 };
      }

      if (imageLoadStatus === 'failed') {
        return { ...queueItem, status: 'failed', imageLoadStatus, imageDownloadProgress: undefined, error: queueItem.error ?? '图片下载失败' };
      }

      return { ...queueItem, imageLoadStatus };
    }));
  }

  function markResultImageLoaded(itemId: string) {
    updateQueueImageLoadStatus(itemId, 'loaded');
    if (selectedQueueItemIdRef.current === itemId) {
      setResultImageStatus('loaded');
    }
  }

  function markResultImageFailed(itemId: string) {
    updateQueueImageLoadStatus(itemId, 'failed');
    if (selectedQueueItemIdRef.current === itemId) {
      setResultImageStatus('failed');
    }
  }

  async function executeQueueItem(item: QueueItem) {
    startTaskTimer(item.id, item.prompt);
    addLog('info', `提交生成请求：${item.prompt}`);

    try {
      const result = await runQueueItem(item);
      const generatedSeconds = stopTaskTimer(item.id);
      const timings = result.timings ?? {
        requestStartedAt: new Date().toISOString(),
        responseReceivedMs: generatedSeconds * 1000,
        jsonParsedMs: 0,
        totalMs: generatedSeconds * 1000,
        requestedUrlOutput: false,
        urlOutputFallback: false
      };
      const timingDetail = `请求到响应 ${formatMilliseconds(timings.responseReceivedMs)}，JSON 解析 ${formatMilliseconds(timings.jsonParsedMs)}，总计 ${formatMilliseconds(timings.totalMs)}`;
      setQueue((current) => current.map((queueItem) => queueItem.id === item.id ? { ...queueItem, status: 'downloading', resultImage: undefined, imageLoadStatus: 'loading', imageDownloadProgress: 0, imageDownloadSpeed: 0, generatedSeconds, downloadSeconds: 0, elapsedSeconds: generatedSeconds } : queueItem));
      if (selectedQueueItemIdRef.current === item.id) {
        setResultImage(undefined);
        setResultImageStatus('loading');
      }
      setStatus(`生成完成：${formatDuration(generatedSeconds)}，开始下载图片`);
      addLog('info', `生成完成：${item.prompt}，${timingDetail}，返回 ${result.sourceType === 'url' ? 'URL' : 'base64'}${timings.urlOutputFallback ? '，URL 模式不支持已自动回退' : ''}`);

      startDownloadTimer(item.id);
      addLog('info', `开始下载图片：${result.sourceType === 'url' ? '远程 URL' : '接口已返回 data URL'}`);
      const imageDataUrl = await window.desktopApi.downloadImage(result.imageSource, item.id);
      const downloadSeconds = stopDownloadTimer(item.id);
      setQueue((current) => current.map((queueItem) => queueItem.id === item.id ? { ...queueItem, status: 'done', resultImage: imageDataUrl, imageLoadStatus: 'loaded', imageDownloadProgress: 100, downloadSeconds, elapsedSeconds: generatedSeconds + downloadSeconds } : queueItem));
      if (selectedQueueItemIdRef.current === item.id) {
        setResultImage(imageDataUrl);
        setResultImageStatus('loaded');
      }
      setStatus(`生成完成：${formatDuration(generatedSeconds)}`);
      addLog('info', `下载完成：${item.prompt}，生成 ${formatDuration(generatedSeconds)}，下载 ${formatDuration(downloadSeconds)}`);
    } catch (error) {
      const wasDownloading = Boolean(downloadStartTimesRef.current[item.id]);
      const phaseSeconds = wasDownloading ? stopDownloadTimer(item.id) : stopTaskTimer(item.id);
      const message = error instanceof Error ? error.message : '图片生成失败';
      setQueue((current) => current.map((queueItem) => {
        if (queueItem.id !== item.id) {
          return queueItem;
        }

        const generatedSeconds = wasDownloading ? queueItem.generatedSeconds : phaseSeconds;
        const downloadSeconds = wasDownloading ? phaseSeconds : queueItem.downloadSeconds;
        return { ...queueItem, status: 'failed', error: message, generatedSeconds, downloadSeconds, elapsedSeconds: generatedSeconds + downloadSeconds };
      }));
      setStatus(`${message}，${wasDownloading ? '下载' : '生成'}用时 ${formatDuration(phaseSeconds)}`);
      addLog('error', `${message}，${wasDownloading ? '下载' : '生成'}用时 ${formatDuration(phaseSeconds)}`);
    }
  }

  async function handleReferenceFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) {
      return;
    }

    const assets = await Promise.all(files.map(readFileAsAsset));
    setReferenceImages((current) => [...current, ...assets]);
    setSelectedReferenceIndex(referenceImages.length);
    event.target.value = '';
  }

  function removeReferenceImage(indexToRemove: number) {
    setReferenceImages((current) => current.filter((_image, index) => index !== indexToRemove));
    setSelectedReferenceIndex(0);
  }

  function getCanvasPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    };
  }

  function paintMask(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const point = getCanvasPoint(event);
    context.globalCompositeOperation = brushMode === 'draw' ? 'source-over' : 'destination-out';
    context.fillStyle = 'rgba(255, 255, 255, 1)';
    context.beginPath();
    context.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2);
    context.fill();
    setMaskDataUrl(canvas.toDataURL('image/png'));
  }

  async function handleMaskFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !file.type.startsWith('image/')) {
      return;
    }

    if (!canvasRef.current) {
      setStatus('请先选择参考图后再导入遮罩');
      return;
    }

    try {
      const asset = await readFileAsAsset(file);
      const image = await loadImage(asset.dataUrl);
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      context?.clearRect(0, 0, canvas.width, canvas.height);
      context?.drawImage(image, 0, 0, canvas.width, canvas.height);
      setMaskDataUrl(canvas.toDataURL('image/png'));
      setStatus('已导入遮罩图');
    } catch (error) {
      const message = error instanceof Error ? error.message : '导入遮罩图失败';
      setStatus(message);
      addLog('error', message);
    }
  }

  function showMaskModeHelp() {
    window.alert([
      '遮罩模式说明：',
      '',
      '1. 透明区保护（默认推荐）',
      '适合使用本工具画笔绘制的遮罩。你画过的区域会被转换成透明区域，通常表示允许 API 重绘；没有画过的区域保持不透明，通常表示保护原图不变。',
      '',
      '2. 灰度原样',
      '适合导入已经准备好的黑白/灰度 mask。系统会按亮度保留原始灰度关系：越亮影响越强，越暗影响越弱。',
      '',
      '3. 灰度反转',
      '适合发现编辑区域刚好相反时使用。系统会先转灰度，再把黑白关系反过来：原本亮的区域变暗，原本暗的区域变亮。',
      '',
      '建议：如果是直接用画笔画遮罩，优先使用“透明区保护”；如果是导入外部 mask，根据接口效果选择“灰度原样”或“灰度反转”。'
    ].join('\n'));
  }

  function clearMask() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    setMaskDataUrl(undefined);
  }

  function clearQueue() {
    Object.values(timersRef.current).forEach((timer) => window.clearInterval(timer));
    Object.values(downloadTimersRef.current).forEach((timer) => window.clearInterval(timer));
    timersRef.current = {};
    startTimesRef.current = {};
    downloadTimersRef.current = {};
    downloadStartTimesRef.current = {};
    setQueue(() => []);
    void window.desktopApi?.saveQueue?.([]);
    setSelectedQueueItemId(undefined);
    setSelectedQueueIds([]);
    setIsQueueSelecting(false);
    setResultImage(undefined);
    setResultImageStatus(undefined);
    setPreviewImage(undefined);
    localStorage.removeItem(QUEUE_STORAGE_KEY);
  }

  function toggleQueueSelection(itemId: string) {
    setSelectedQueueIds((current) => current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]);
  }

  function deleteSelectedQueueItems() {
    const ids = new Set(selectedQueueIds);
    selectedQueueIds.forEach((id) => {
      if (timersRef.current[id]) {
        window.clearInterval(timersRef.current[id]);
        delete timersRef.current[id];
      }
      if (downloadTimersRef.current[id]) {
        window.clearInterval(downloadTimersRef.current[id]);
        delete downloadTimersRef.current[id];
      }
      delete startTimesRef.current[id];
      delete downloadStartTimesRef.current[id];
    });

    setQueue((current) => current.filter((item) => !ids.has(item.id)));
    setSelectedQueueIds([]);
    setIsQueueSelecting(false);
    if (selectedQueueItemId && ids.has(selectedQueueItemId)) {
      setSelectedQueueItemId(undefined);
      setResultImage(undefined);
      setResultImageStatus(undefined);
      setPreviewImage(undefined);
    }
  }

  function selectAllQueueItems() {
    setSelectedQueueIds(queue.map((item) => item.id));
  }

  function cancelQueueSelection() {
    setIsQueueSelecting(false);
    setSelectedQueueIds([]);
  }

  async function generateImage() {
    const validationError = validateInput();
    if (validationError) {
      setStatus(validationError);
      addLog('error', validationError);
      return;
    }

    let item: QueueItem;
    try {
      item = await snapshotQueueItem();
    } catch (error) {
      const message = error instanceof Error ? error.message : '遮罩图片处理失败';
      setStatus(message);
      addLog('error', message);
      return;
    }

    setQueue((current) => [item, ...current]);
    setSelectedQueueItemId(item.id);
    setResultImage(undefined);
    setResultImageStatus(undefined);
    setContextSourceTaskId(undefined);
    setStatus('已创建任务，开始生成');
    void executeQueueItem(item);
  }

  function selectQueueItem(item: QueueItem) {
    setSelectedQueueItemId(item.id);
    pendingMaskDataUrlRef.current = item.maskSourceDataUrl ?? item.maskImage?.dataUrl;
    setReferenceImages(item.referenceImages ?? []);
    setSelectedReferenceIndex(0);
    setMaskDataUrl(item.maskSourceDataUrl ?? item.maskImage?.dataUrl);
    setMaskMode(item.maskMode ?? 'alpha');
    setResultImage(item.resultImage ?? item.generationPreviewImage);
    setResultImageStatus(item.resultImage ? (item.imageLoadStatus ?? 'loading') : (item.generationPreviewImage ? 'loading' : undefined));

    if (item.error) {
      setStatus(`${item.error}，${formatQueueActivity(item)}`);
    } else {
      setStatus(`队列任务：${formatQueueActivity(item)}`);
    }
  }

  function retryQueueItem(item: QueueItem) {
    const retryItem: QueueItem = {
      ...item,
      status: 'generating',
      error: undefined,
      resultImage: undefined,
      imageLoadStatus: undefined,
      imageDownloadProgress: undefined,
      imageDownloadSpeed: 0,
      generatedSeconds: 0,
      downloadSeconds: 0,
      elapsedSeconds: 0
    };

    setQueue((current) => current.map((queueItem) => queueItem.id === item.id ? retryItem : queueItem));
    if (selectedQueueItemIdRef.current === item.id) {
      setResultImage(undefined);
      setResultImageStatus(undefined);
    }

    setStatus('已重新开始任务');
    void executeQueueItem(retryItem);
  }

  function handleQueueItemClick(item: QueueItem) {
    if (isQueueSelecting) {
      toggleQueueSelection(item.id);
      return;
    }

    selectQueueItem(item);
  }

  function fillReferenceFromQueueItem(item: QueueItem) {
    if (!item.resultImage) {
      return;
    }

    const nextIndex = referenceImages.length;
    setReferenceImages((current) => [...current, { name: 'queue-result.png', mimeType: 'image/png', dataUrl: item.resultImage! }]);
    setSelectedReferenceIndex(nextIndex);
    setMaskDataUrl(undefined);
    setStatus('已将任务结果填入参考图');
  }

  async function copyPromptFromQueueItem(item: QueueItem) {
    try {
      await navigator.clipboard.writeText(item.prompt);
      setStatus('已复制提示词');
      addLog('info', '已复制提示词');
    } catch (error) {
      const message = error instanceof Error ? error.message : '复制提示词失败';
      setStatus(message);
      addLog('error', message);
    }
  }

  function selectAdjacentResult(direction: -1 | 1) {
    if (contextResultItems.length < 2) {
      return;
    }

    const currentIndex = selectedContextResultIndex >= 0 ? selectedContextResultIndex : 0;
    const nextIndex = (currentIndex + direction + contextResultItems.length) % contextResultItems.length;
    selectQueueItem(contextResultItems[nextIndex]);
  }

  async function saveResult() {
    if (!resultImage) {
      return;
    }

    if (!window.desktopApi) {
      setStatus('桌面桥接未加载，请使用 npm run dev 启动 Electron 应用，不要直接打开浏览器页面');
      return;
    }

    const result = await window.desktopApi.saveImage(resultImage);
    if (!result.canceled) {
      setStatus(`已保存：${result.filePath}`);
      addLog('info', `已保存：${result.filePath}`);
    }
  }

  return (
    <main className="app-shell">
      <section className="sidebar panel">
        <h1>GPT Image 2 Studio</h1>
        <p className="subtitle">跨 macOS / Windows 的参考图编辑与生成工具</p>

        <details className="settings-details" open={isSettingsOpen} onToggle={(event) => setIsSettingsOpen(event.currentTarget.open)}>
          <summary>API 与模型设置</summary>
          <label>API Base URL<input value={settings.apiBaseUrl} onChange={(event) => setSettings({ ...settings, apiBaseUrl: event.target.value })} /></label>
          <label>API Key<input type="password" value={settings.apiKey} onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })} placeholder="sk-..." /></label>
          <label>Model<input value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })} /></label>
        </details>
        <label>图片尺寸<select value={size} onChange={(event) => setSize(event.target.value as ImageSize)}>{IMAGE_SIZES.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>生成提示词<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述希望生成或编辑的图片内容..." /></label>
        <div className="timer-card">生成中 <strong>{generatingCount}</strong></div>

        <div className="button-row">
          <button className="primary" disabled={!canSubmit} onClick={generateImage}>生成图片</button>
        </div>
        <p className="status">{status}</p>
      </section>

      <section className="workspace">
        <div className="top-grid">
          <div className="panel reference-panel">
            <div className="panel-title"><h2>参考图区域</h2><label className="file-button">添加图片<input multiple accept="image/*" type="file" onChange={handleReferenceFiles} /></label></div>
            <div className="thumb-list">
              {referenceImages.map((image, index) => (
                <button className={index === selectedReferenceIndex ? 'thumb active' : 'thumb'} key={`${image.name}-${index}`} onClick={() => setSelectedReferenceIndex(index)}>
                  <img src={image.dataUrl} alt={image.name} /><span>{image.name}</span><small onClick={(event) => { event.stopPropagation(); removeReferenceImage(index); }}>移除</small>
                </button>
              ))}
              {referenceImages.length === 0 && <div className="compact-empty">可不添加参考图直接生成</div>}
            </div>
          </div>

          <div className="panel queue-panel">
            <div className="panel-title">
              <h2>队列</h2>
              {isQueueSelecting ? <div className="queue-actions"><button onClick={selectAllQueueItems} disabled={queue.length === 0}>全选</button><button onClick={deleteSelectedQueueItems} disabled={selectedQueueIds.length === 0}>删除选中</button><button onClick={cancelQueueSelection}>取消</button></div> : <button onClick={() => setIsQueueSelecting(true)} disabled={queue.length === 0}>清理</button>}
            </div>
            <div className="queue-list" ref={queueListRef}>
              {queue.map((item) => {
                const thumbnail = item.resultImage ?? item.generationPreviewImage ?? item.referenceImages?.[0]?.dataUrl ?? item.maskImage?.dataUrl;
                return (
                  <div
                    data-queue-id={item.id}
                    className={`queue-item ${item.status}${item.id === selectedQueueItemId ? ' active' : ''}${selectedQueueIds.includes(item.id) ? ' selected' : ''}`}
                    key={item.id}
                    onClick={() => handleQueueItemClick(item)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') handleQueueItemClick(item); }}
                    role="button"
                    tabIndex={0}
                  >
                    {isQueueSelecting && <span className="queue-check">{selectedQueueIds.includes(item.id) ? '已选' : '选择'}</span>}
                    {thumbnail ? (
                      <span className="queue-thumb-column">
                        <span className="queue-thumb-wrap">
                          <img
                            className="queue-thumb"
                            src={thumbnail}
                            alt="任务缩略图"
                            onLoad={() => item.resultImage && markResultImageLoaded(item.id)}
                            onError={() => item.resultImage && markResultImageFailed(item.id)}
                          />
                          {item.status === 'generating' && item.generationPreviewImage && <span className="image-load-badge">草稿 {item.generationPartialCount ?? 1}</span>}
                          {item.status === 'downloading' && <span className="image-load-badge">{item.imageDownloadProgress ?? 0}% · {formatSpeed(item.imageDownloadSpeed)}</span>}
                          {item.status === 'failed' && !isQueueSelecting && (
                            <button
                              className="retry-thumb-button"
                              type="button"
                              onClick={(event) => { event.stopPropagation(); retryQueueItem(item); }}
                              aria-label="重试任务"
                            >
                              ↻
                            </button>
                          )}
                        </span>
                        {item.status === 'done' && item.resultImage && !isQueueSelecting && (
                          <span className="queue-item-actions">
                            <button className="context-action-button icon" type="button" data-tip="填入参考图" aria-label="填入参考图" onClick={(event) => { event.stopPropagation(); fillReferenceFromQueueItem(item); }}>↙</button>
                            <button className="context-action-button icon secondary" type="button" data-tip="复制提示词" aria-label="复制提示词" onClick={(event) => { event.stopPropagation(); void copyPromptFromQueueItem(item); }}>⧉</button>
                          </span>
                        )}
                      </span>
                    ) : item.status === 'failed' && !isQueueSelecting ? (
                      <div className="queue-thumb queue-thumb-empty retry-thumb-wrap">
                        <button
                          className="retry-thumb-button"
                          type="button"
                          onClick={(event) => { event.stopPropagation(); retryQueueItem(item); }}
                          aria-label="重试任务"
                        >
                          ↻
                        </button>
                      </div>
                    ) : (
                      <div className="queue-thumb queue-thumb-empty">无图</div>
                    )}
                    <strong>{item.status}</strong>
                    <span>{item.createdAt}</span>
                    <p>{item.prompt}</p>
                    <small>{formatQueueActivity(item)}</small>
                    {item.error && <em>{item.error}</em>}
                  </div>
                );
              })}
              {queue.length === 0 && <div className="compact-empty">暂无队列任务</div>}
            </div>
          </div>
        </div>

        <div className="editor-grid">
          <div className="panel canvas-panel">
            <div className="panel-title">
              <h2>绘制区域</h2>
              <div className="toolbar">
                <button className={brushMode === 'draw' ? 'active-tool' : ''} onClick={() => setBrushMode('draw')}>绘制</button>
                <button className={brushMode === 'erase' ? 'active-tool' : ''} onClick={() => setBrushMode('erase')}>擦除</button>
                <label className="range-label">笔刷 {brushSize}px<input type="range" min="8" max="120" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /></label>
                <label className="mask-mode-label">遮罩模式<select value={maskMode} onChange={(event) => setMaskMode(event.target.value as MaskMode)}><option value="alpha">透明区保护</option><option value="gray">灰度原样</option><option value="invert-gray">灰度反转</option></select><button className="help-button" type="button" onClick={showMaskModeHelp}>?</button></label>
                <label className="file-button">导入遮罩<input accept="image/*" type="file" onChange={handleMaskFile} /></label>
                <button onClick={clearMask}>清空</button>
              </div>
            </div>
            <div className="mask-stage">
              {selectedReference ? <img className="base-image" src={selectedReference.dataUrl} alt="当前参考图" /> : <div className="empty-state">添加参考图后可绘制遮罩</div>}
              {selectedReference && <canvas ref={canvasRef} className="mask-canvas" style={{ aspectRatio: imageRef.current ? `${imageRef.current.naturalWidth} / ${imageRef.current.naturalHeight}` : undefined }} onPointerDown={(event) => { setIsDrawing(true); event.currentTarget.setPointerCapture(event.pointerId); paintMask(event); }} onPointerMove={(event) => { if (isDrawing) paintMask(event); }} onPointerUp={() => setIsDrawing(false)} onPointerCancel={() => setIsDrawing(false)} />}
            </div>
          </div>

          <div className="side-stack">
            <div className="panel result-panel">
              <div className="panel-title result-title"><button disabled={contextResultItems.length < 2} onClick={() => selectAdjacentResult(-1)}>←</button><h2>生成结果</h2><button disabled={contextResultItems.length < 2} onClick={() => selectAdjacentResult(1)}>→</button><button disabled={!resultImage} onClick={saveResult}>保存图片</button></div>
              {selectedQueueItem && <p className="queue-detail">当前查看：{selectedQueueItem.status} · {formatQueueActivity(selectedQueueItem)}</p>}
              {selectedQueueItem && <p className="context-detail">上下文结果 {selectedContextResultIndex >= 0 ? selectedContextResultIndex + 1 : 0}/{contextResultItems.length} · 参考图 {selectedQueueItem.referenceImages?.length ?? 0} 张 · {selectedQueueItem.maskImage ? `含 mask · ${selectedQueueItem.maskMode ?? 'alpha'}` : '无 mask'}</p>}
              {resultImage ? (
                <button className="result-preview-button" onClick={() => setPreviewImage(resultImage)}>
                  <img
                    className="result-image"
                    src={resultImage}
                    alt="生成结果"
                    onLoad={() => selectedQueueItemId && selectedQueueItem?.resultImage && markResultImageLoaded(selectedQueueItemId)}
                    onError={() => selectedQueueItemId && selectedQueueItem?.resultImage && markResultImageFailed(selectedQueueItemId)}
                  />
                  {selectedQueueItem?.status === 'generating' && <span className="result-image-badge">生成草稿 {selectedQueueItem.generationPartialCount ?? 1}</span>}
                  {resultImageStatus === 'loading' && selectedQueueItem?.status !== 'generating' && <span className="result-image-badge">下载中 {selectedQueueItem?.imageDownloadProgress ?? 0}% · {formatSpeed(selectedQueueItem?.imageDownloadSpeed)}</span>}
                  {resultImageStatus === 'failed' && <span className="result-image-badge error">图片加载失败</span>}
                </button>
              ) : selectedQueueItem?.generationPreviewImage ? (
                <button className="result-preview-button" onClick={() => setPreviewImage(selectedQueueItem.generationPreviewImage)}>
                  <img className="result-image" src={selectedQueueItem.generationPreviewImage} alt="生成草稿" />
                  <span className="result-image-badge">生成草稿 {selectedQueueItem.generationPartialCount ?? 1}</span>
                </button>
              ) : (
                <div className="empty-state">生成后的图片会显示在这里</div>
              )}
            </div>
            <div className="panel log-panel">
              <div className="panel-title"><h2>调用日志</h2><button onClick={() => setLogs([])} disabled={logs.length === 0}>清空</button></div>
              <div className="log-list">
                {logs.map((log) => <div className={`log-entry ${log.level}`} key={log.id}><span>{log.timestamp}</span><p>{log.message}</p></div>)}
                {logs.length === 0 && <div className="compact-empty">暂无日志</div>}
              </div>
            </div>
          </div>
        </div>
      </section>

      {previewImage && <button className="preview-backdrop" onClick={() => setPreviewImage(undefined)}><img className="preview-image" src={previewImage} alt="放大生成结果" /></button>}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
