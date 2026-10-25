const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),

  setSettings: settings => ipcRenderer.invoke('set-settings', settings),

  // 用于切换边框模式
  restartWindow: () => ipcRenderer.invoke('restart-window'),

  quitApp: () => ipcRenderer.invoke('quit-app')
})
