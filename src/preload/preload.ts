import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, GenerateImageRequest } from '../shared.js';

const desktopApi: DesktopApi = {
  generateImage(request: GenerateImageRequest) {
    return ipcRenderer.invoke('image:generate', request);
  },
  saveImage(dataUrl: string) {
    return ipcRenderer.invoke('image:save', dataUrl);
  }
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);
