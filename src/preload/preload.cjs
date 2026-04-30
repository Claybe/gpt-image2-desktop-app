const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  generateImage(request) {
    return ipcRenderer.invoke('image:generate', request);
  },
  loadQueue() {
    return ipcRenderer.invoke('queue:load');
  },
  saveQueue(queue) {
    return ipcRenderer.invoke('queue:save', queue);
  },
  downloadImage(url, itemId) {
    return ipcRenderer.invoke('image:download', url, itemId);
  },
  onImageGenerationProgress(callback) {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('image:generation-progress', listener);
    return () => ipcRenderer.removeListener('image:generation-progress', listener);
  },
  onImageDownloadProgress(callback) {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('image:download-progress', listener);
    return () => ipcRenderer.removeListener('image:download-progress', listener);
  },
  saveImage(dataUrl) {
    return ipcRenderer.invoke('image:save', dataUrl);
  }
});
