import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppSettings, GenerateImageRequest, ImageAsset, ImageSize } from '../../shared.js';
import './styles.css';

const DEFAULT_SETTINGS: AppSettings = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-image-2'
};

const IMAGE_SIZES: ImageSize[] = ['1024x1024', '1024x1536', '1536x1024', 'auto'];

type BrushMode = 'draw' | 'erase';
type QueueStatus = 'pending' | 'running' | 'done' | 'failed';

interface QueueItem {
  id: string;
  prompt: string;
  size: ImageSize;
  referenceImages: ImageAsset[];
  maskImage?: ImageAsset;
  status: QueueStatus;
  createdAt: string;
  error?: string;
  resultImage?: string;
  elapsedSeconds?: number;
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
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  return minutes > 0 ? `${minutes}分${restSeconds}秒` : `${restSeconds}秒`;
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const queueRunnerRef = useRef(false);
  const queueRef = useRef<QueueItem[]>([]);
  const elapsedTimerRef = useRef<number | undefined>(undefined);
  const taskStartTimeRef = useRef(0);
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('gpt-image2-settings');
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
  });
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<ImageSize>('1024x1024');
  const [referenceImages, setReferenceImages] = useState<ImageAsset[]>([]);
  const [selectedReferenceIndex, setSelectedReferenceIndex] = useState(0);
  const [brushSize, setBrushSize] = useState(36);
  const [brushMode, setBrushMode] = useState<BrushMode>('draw');
  const [isDrawing, setIsDrawing] = useState(false);
  const [maskDataUrl, setMaskDataUrl] = useState<string>();
  const [resultImage, setResultImage] = useState<string>();
  const [status, setStatus] = useState('准备就绪');
  const [isGenerating, setIsGenerating] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [queue, setQueueState] = useState<QueueItem[]>([]);
  const [selectedQueueItemId, setSelectedQueueItemId] = useState<string>();
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const selectedReference = referenceImages[selectedReferenceIndex];
  const selectedQueueItem = queue.find((item) => item.id === selectedQueueItemId);
  const hasPendingQueue = queue.some((item) => item.status === 'pending');

  const canSubmit = useMemo(() => {
    return true;
  }, []);

  function setQueue(updater: (current: QueueItem[]) => QueueItem[]) {
    const next = updater(queueRef.current);
    queueRef.current = next;
    setQueueState(next);
  }

  useEffect(() => {
    localStorage.setItem('gpt-image2-settings', JSON.stringify(settings));
  }, [settings]);

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
      setMaskDataUrl(undefined);
    };
    image.src = selectedReference.dataUrl;
    imageRef.current = image;
  }, [selectedReference]);

  function startElapsedTimer() {
    taskStartTimeRef.current = Date.now();
    setElapsedSeconds(0);
    if (elapsedTimerRef.current) {
      window.clearInterval(elapsedTimerRef.current);
    }

    elapsedTimerRef.current = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - taskStartTimeRef.current) / 1000));
    }, 1000);
  }

  function stopElapsedTimer() {
    const elapsed = Math.floor((Date.now() - taskStartTimeRef.current) / 1000);
    if (elapsedTimerRef.current) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = undefined;
    }

    setElapsedSeconds(elapsed);
    return elapsed;
  }

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

  function snapshotQueueItem(): QueueItem {
    return {
      id: crypto.randomUUID(),
      prompt,
      size,
      referenceImages: [...referenceImages],
      maskImage: maskDataUrl ? { name: 'mask.png', mimeType: 'image/png', dataUrl: maskDataUrl } : undefined,
      status: 'pending',
      createdAt: formatClock()
    };
  }

  async function runQueueItem(item: QueueItem) {
    if (!window.desktopApi) {
      throw new Error('桌面桥接未加载，请使用 npm run dev 启动 Electron 应用，不要直接打开浏览器页面');
    }

    const request: GenerateImageRequest = {
      settings,
      prompt: item.prompt,
      size: item.size,
      referenceImages: item.referenceImages,
      maskImage: item.maskImage
    };
    return window.desktopApi.generateImage(request);
  }

  async function runQueue() {
    if (queueRunnerRef.current) {
      return;
    }

    queueRunnerRef.current = true;
    setIsGenerating(true);

    try {
      while (true) {
        const nextItem = queueRef.current.find((item) => item.status === 'pending');
        if (!nextItem) {
          break;
        }

        setSelectedQueueItemId(nextItem.id);
        setQueue((current) => current.map((item) => item.id === nextItem.id ? { ...item, status: 'running' } : item));
        setStatus(`正在执行队列任务：${nextItem.prompt.slice(0, 24)}`);
        addLog('info', `开始任务：${nextItem.prompt}`);

        try {
          startElapsedTimer();
          const result = await runQueueItem(nextItem);
          const elapsed = stopElapsedTimer();
          setResultImage(result.imageDataUrl);
          setQueue((current) => current.map((item) => item.id === nextItem.id ? { ...item, status: 'done', resultImage: result.imageDataUrl, elapsedSeconds: elapsed } : item));
          setStatus(`队列任务完成，用时 ${formatDuration(elapsed)}`);
          addLog('info', `任务完成：${nextItem.prompt}，用时 ${formatDuration(elapsed)}`);
        } catch (error) {
          const elapsed = stopElapsedTimer();
          const message = error instanceof Error ? error.message : '图片生成失败';
          setQueue((current) => current.map((item) => item.id === nextItem.id ? { ...item, status: 'failed', error: message, elapsedSeconds: elapsed } : item));
          setStatus(`${message}，用时 ${formatDuration(elapsed)}`);
          addLog('error', `${message}，用时 ${formatDuration(elapsed)}`);
        }
      }
    } finally {
      queueRunnerRef.current = false;
      setIsGenerating(false);
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

  function clearMask() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    setMaskDataUrl(undefined);
  }

  function addCurrentToQueue() {
    const validationError = validateInput();
    if (validationError) {
      setStatus(validationError);
      addLog('error', validationError);
      return undefined;
    }

    const item = snapshotQueueItem();
    setQueue((current) => [...current, item]);
    setSelectedQueueItemId(item.id);
    setStatus('已加入生成队列');
    addLog('info', `加入队列：${item.prompt}`);
    return item;
  }

  async function generateImage() {
    const item = addCurrentToQueue();
    if (item) {
      window.setTimeout(() => void runQueue(), 0);
    }
  }

  function selectQueueItem(item: QueueItem) {
    setSelectedQueueItemId(item.id);
    if (item.resultImage) {
      setResultImage(item.resultImage);
    }

    if (item.error) {
      setStatus(item.error);
    } else {
      setStatus(`队列任务状态：${item.status}`);
    }
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

        <label>API Base URL<input value={settings.apiBaseUrl} onChange={(event) => setSettings({ ...settings, apiBaseUrl: event.target.value })} /></label>
        <label>API Key<input type="password" value={settings.apiKey} onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })} placeholder="sk-..." /></label>
        <label>Model<input value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })} /></label>
        <label>图片尺寸<select value={size} onChange={(event) => setSize(event.target.value as ImageSize)}>{IMAGE_SIZES.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>生成提示词<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述希望生成或编辑的图片内容..." /></label>
        <div className="timer-card">当前耗时 <strong>{formatDuration(elapsedSeconds)}</strong></div>

        <div className="button-row">
          <button className="primary" disabled={!canSubmit} onClick={generateImage}>{isGenerating ? '生成中...' : '生成图片'}</button>
          <button disabled={!canSubmit} onClick={addCurrentToQueue}>加入队列</button>
          <button disabled={!hasPendingQueue || isGenerating} onClick={() => void runQueue()}>执行队列</button>
        </div>
        <p className="status">{status} · 当前耗时 {formatDuration(elapsedSeconds)}</p>
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
            <div className="panel-title"><h2>队列</h2><button onClick={() => { setQueue(() => []); setSelectedQueueItemId(undefined); }} disabled={queue.length === 0 || isGenerating}>清空</button></div>
            <div className="queue-list">
              {queue.map((item) => <button className={`queue-item ${item.status}${item.id === selectedQueueItemId ? ' active' : ''}`} key={item.id} onClick={() => selectQueueItem(item)}><strong>{item.status}</strong><span>{item.createdAt}</span><p>{item.prompt}</p>{typeof item.elapsedSeconds === 'number' && <small>用时 {formatDuration(item.elapsedSeconds)}</small>}{item.error && <em>{item.error}</em>}</button>)}
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
              <div className="panel-title"><h2>生成结果</h2><button disabled={!resultImage} onClick={saveResult}>保存图片</button></div>
              {selectedQueueItem && <p className="queue-detail">当前查看：{selectedQueueItem.status} · 用时 {formatDuration(selectedQueueItem.elapsedSeconds ?? elapsedSeconds)} · {selectedQueueItem.prompt}</p>}
              {resultImage ? <img className="result-image" src={resultImage} alt="生成结果" /> : <div className="empty-state">生成后的图片会显示在这里</div>}
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
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
