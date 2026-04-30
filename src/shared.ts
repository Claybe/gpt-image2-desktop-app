export type ImageAspectRatio = 'custom' | '16:9' | '9:16' | '3:2' | '4:3' | '1:1';
export type ImageResolution = '1k' | '2k' | '4k';
export type ImageSize = 'auto' | `${number}x${number}`;
export type MaskMode = 'alpha' | 'gray' | 'invert-gray';

const IMAGE_ASPECT_RATIO_RE = /(?:比例|出图比例|画幅|aspect[- ]?ratio|ratio)?\s*(16[:：]9|9[:：]16|3[:：]2|4[:：]3|1[:：]1)/i;

export function inferImageAspectRatio(prompt: string): Exclude<ImageAspectRatio, 'custom'> | undefined {
  const match = IMAGE_ASPECT_RATIO_RE.exec(prompt);
  return match?.[1]?.replace('：', ':') as Exclude<ImageAspectRatio, 'custom'> | undefined;
}

export function getImageSize(aspectRatio: ImageAspectRatio, resolution: ImageResolution, prompt = ''): ImageSize {
  const resolvedAspectRatio = aspectRatio === 'custom' ? inferImageAspectRatio(prompt) : aspectRatio;
  if (!resolvedAspectRatio) {
    return 'auto';
  }

  const base = resolution === '4k' ? 4096 : resolution === '2k' ? 2048 : 1024;
  const [widthRatio, heightRatio] = resolvedAspectRatio.split(':').map(Number);
  if (widthRatio === heightRatio) {
    return `${base}x${base}`;
  }

  if (widthRatio > heightRatio) {
    return `${Math.round(base * (widthRatio / heightRatio))}x${base}`;
  }

  return `${base}x${Math.round(base * (heightRatio / widthRatio))}`;
}

export interface AppSettings {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
}

export interface ImageAsset {
  name: string;
  mimeType: string;
  dataUrl: string;
}

export interface GenerateImageRequest {
  itemId?: string;
  settings: AppSettings;
  prompt: string;
  aspectRatio: ImageAspectRatio;
  resolution: ImageResolution;
  size: ImageSize;
  referenceImages: ImageAsset[];
  maskImage?: ImageAsset;
  maskMode?: MaskMode;
}

export interface GenerateImageTimings {
  requestStartedAt: string;
  responseReceivedMs: number;
  jsonParsedMs: number;
  totalMs: number;
  requestedUrlOutput: boolean;
  urlOutputFallback: boolean;
}

export interface GenerateImageResult {
  imageSource: string;
  sourceType: 'dataUrl' | 'url';
  rawResponse: unknown;
  timings: GenerateImageTimings;
}

export interface GenerateImageProgress {
  itemId: string;
  type: 'request_started' | 'response_received' | 'stream_started' | 'stream_event' | 'partial_image' | 'completed' | 'fallback';
  message: string;
  partialImageIndex?: number;
  eventIndex?: number;
  elapsedMs?: number;
  streamBytes?: number;
  imageDataUrl?: string;
}

export interface DownloadImageProgress {
  itemId: string;
  progress: number;
  bytesReceived: number;
  totalBytes?: number;
  bytesPerSecond: number;
}

export interface DesktopApi {
  generateImage(request: GenerateImageRequest): Promise<GenerateImageResult>;
  loadQueue(): Promise<unknown[]>;
  saveQueue(queue: unknown[]): Promise<void>;
  downloadImage(url: string, itemId: string): Promise<string>;
  onImageGenerationProgress(callback: (progress: GenerateImageProgress) => void): () => void;
  onImageDownloadProgress(callback: (progress: DownloadImageProgress) => void): () => void;
  saveImage(dataUrl: string): Promise<{ canceled: boolean; filePath?: string }>;
}

declare global {
  interface Window {
    desktopApi: DesktopApi;
  }
}
