import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DesktopApi, DownloadImageProgress, GenerateImageRequest } from '../shared.js';

const desktopApi: DesktopApi = {
  generateImage(request: GenerateImageRequest) {
    return ipcRenderer.invoke('image:generate', request);
  },
  downloadImage(url: string, itemId: string) {
    return ipcRenderer.invoke('image:download', url, itemId);
  },
  onImageDownloadProgress(callback: (progress: DownloadImageProgress) => void) {
    const listener = (_event: IpcRendererEvent, progress: DownloadImageProgress) => callback(progress);
    ipcRenderer.on('image:download-progress', listener);
    return () => ipcRenderer.removeListener('image:download-progress', listener);
  },
  saveImage(dataUrl: string) {
    return ipcRenderer.invoke('image:save', dataUrl);
  }
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);
