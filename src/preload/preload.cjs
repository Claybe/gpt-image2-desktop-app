const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  generateImage(request) {
    return ipcRenderer.invoke('image:generate', request);
  },
  downloadImage(url, itemId) {
    return ipcRenderer.invoke('image:download', url, itemId);
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
