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

function readFileAsAsset(file: File): Promise<ImageAsset> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, mimeType: file.type || 'image/png', dataUrl: String(reader.result) });
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`));
    reader.readAsDataURL(file);
  });
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('gpt-image2-settings');
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved), apiKey: '' } : DEFAULT_SETTINGS;
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

  const selectedReference = referenceImages[selectedReferenceIndex];

  const canSubmit = useMemo(() => {
    return !isGenerating;
  }, [isGenerating]);

  useEffect(() => {
    localStorage.setItem('gpt-image2-settings', JSON.stringify({ ...settings, apiKey: '' }));
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

  async function generateImage() {
    if (!settings.apiKey.trim()) {
      setStatus('请填写 API Key');
      return;
    }

    if (!prompt.trim()) {
      setStatus('请填写提示词');
      return;
    }

    setIsGenerating(true);
    setStatus('正在调用图片生成 API...');

    try {
      if (!window.desktopApi) {
        setStatus('桌面桥接未加载，请使用 npm run dev 启动 Electron 应用，不要直接打开浏览器页面');
        return;
      }

      const request: GenerateImageRequest = {
        settings,
        prompt,
        size,
        referenceImages,
        maskImage: maskDataUrl ? { name: 'mask.png', mimeType: 'image/png', dataUrl: maskDataUrl } : undefined
      };
      const result = await window.desktopApi.generateImage(request);
      setResultImage(result.imageDataUrl);
      setStatus('图片生成完成');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '图片生成失败');
    } finally {
      setIsGenerating(false);
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
    }
  }

  return (
    <main className="app-shell">
      <section className="sidebar panel">
        <h1>GPT Image 2 Studio</h1>
        <p className="subtitle">跨 macOS / Windows 的参考图编辑与生成工具</p>

        <label>
          API Base URL
          <input value={settings.apiBaseUrl} onChange={(event) => setSettings({ ...settings, apiBaseUrl: event.target.value })} />
        </label>

        <label>
          API Key
          <input type="password" value={settings.apiKey} onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })} placeholder="sk-..." />
        </label>

        <label>
          Model
          <input value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })} />
        </label>

        <label>
          图片尺寸
          <select value={size} onChange={(event) => setSize(event.target.value as ImageSize)}>
            {IMAGE_SIZES.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>

        <label>
          生成提示词
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述希望生成或编辑的图片内容..." />
        </label>

        <button className="primary" disabled={!canSubmit} onClick={generateImage}>{isGenerating ? '生成中...' : '生成图片'}</button>
        <p className="status">{status}</p>
      </section>

      <section className="workspace">
        <div className="panel reference-panel">
          <div className="panel-title">
            <h2>参考图</h2>
            <label className="file-button">
              添加图片
              <input multiple accept="image/*" type="file" onChange={handleReferenceFiles} />
            </label>
          </div>

          <div className="thumb-list">
            {referenceImages.map((image, index) => (
              <button className={index === selectedReferenceIndex ? 'thumb active' : 'thumb'} key={`${image.name}-${index}`} onClick={() => setSelectedReferenceIndex(index)}>
                <img src={image.dataUrl} alt={image.name} />
                <span>{image.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="editor-grid">
          <div className="panel canvas-panel">
            <div className="panel-title">
              <h2>遮罩绘制</h2>
              <div className="toolbar">
                <button className={brushMode === 'draw' ? 'active-tool' : ''} onClick={() => setBrushMode('draw')}>绘制</button>
                <button className={brushMode === 'erase' ? 'active-tool' : ''} onClick={() => setBrushMode('erase')}>擦除</button>
                <label className="range-label">笔刷 {brushSize}px<input type="range" min="8" max="120" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /></label>
                <button onClick={clearMask}>清空</button>
              </div>
            </div>

            <div className="mask-stage">
              {selectedReference ? <img className="base-image" src={selectedReference.dataUrl} alt="当前参考图" /> : <div className="empty-state">添加参考图后可绘制遮罩</div>}
              {selectedReference && (
                <canvas
                  ref={canvasRef}
                  className="mask-canvas"
                  style={{ aspectRatio: imageRef.current ? `${imageRef.current.naturalWidth} / ${imageRef.current.naturalHeight}` : undefined }}
                  onPointerDown={(event) => { setIsDrawing(true); event.currentTarget.setPointerCapture(event.pointerId); paintMask(event); }}
                  onPointerMove={(event) => { if (isDrawing) paintMask(event); }}
                  onPointerUp={() => setIsDrawing(false)}
                  onPointerCancel={() => setIsDrawing(false)}
                />
              )}
            </div>
          </div>

          <div className="panel result-panel">
            <div className="panel-title">
              <h2>生成结果</h2>
              <button disabled={!resultImage} onClick={saveResult}>保存图片</button>
            </div>
            {resultImage ? <img className="result-image" src={resultImage} alt="生成结果" /> : <div className="empty-state">生成后的图片会显示在这里</div>}
          </div>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
