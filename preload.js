const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shell', {
  quit: () => ipcRenderer.send('quit-app'),
  untuck: () => ipcRenderer.send('untuck'),
  onTuck: (callback) => ipcRenderer.on('tuck-state', (_event, state) => callback(state)),
  loadTasks: () => ipcRenderer.invoke('tasks:load'),
  saveTasks: (items) => ipcRenderer.send('tasks:save', items),
  showTaskMenu: (id, priority) => ipcRenderer.send('show-task-menu', id, priority),
  onTaskMenuChoice: (callback) => ipcRenderer.on('task-menu-choice', (_event, data) => callback(data))
});
