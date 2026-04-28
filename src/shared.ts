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
  settings: AppSettings;
  prompt: string;
  size: ImageSize;
  referenceImages: ImageAsset[];
  maskImage?: ImageAsset;
  maskMode?: MaskMode;
}

export interface GenerateImageResult {
  imageDataUrl: string;
  rawResponse: unknown;
}

export interface DesktopApi {
  generateImage(request: GenerateImageRequest): Promise<GenerateImageResult>;
  saveImage(dataUrl: string): Promise<{ canceled: boolean; filePath?: string }>;
}

declare global {
  interface Window {
    desktopApi: DesktopApi;
  }
}
