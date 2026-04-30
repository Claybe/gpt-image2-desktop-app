export type ImageSize = '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
export type MaskMode = 'alpha' | 'gray' | 'invert-gray';

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
