const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  generateImage(request) {
    return ipcRenderer.invoke('image:generate', request);
  },
  saveImage(dataUrl) {
    return ipcRenderer.invoke('image:save', dataUrl);
  }
});
