const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('shell', {
  quit: () => ipcRenderer.send('quit-app'),
  untuck: () => ipcRenderer.send('untuck'),
  onTuck: (callback) => ipcRenderer.on('tuck-state', (_event, state) => callback(state)),

  loadTasks: () => ipcRenderer.invoke('tasks:load'),
  addTask: (item) => ipcRenderer.send('tasks:add', item),
  updateTask: (item) => ipcRenderer.send('tasks:update', item),
  deleteTask: (id) => ipcRenderer.send('tasks:delete', id),
  clearDone: () => ipcRenderer.send('tasks:clear-done'),
  reorderTasks: (orderedIds) => ipcRenderer.send('tasks:reorder', orderedIds),
  migrateTasks: (items) => ipcRenderer.send('tasks:migrate', items),
  onTasksChanged: (callback) => ipcRenderer.on('tasks-changed', (_event, data) => callback(data)),

  showTaskMenu: (id, priority) => ipcRenderer.send('show-task-menu', id, priority),

  openDetail: (taskId) => ipcRenderer.send('open-detail', taskId),
  closeDetail: () => ipcRenderer.send('close-detail'),
  onShowTask: (callback) => ipcRenderer.on('show-task', (_event, task) => callback(task)),

  pickFiles: () => ipcRenderer.invoke('pick-files'),
  copyFile: (taskId, sourcePath) => ipcRenderer.invoke('att:copy', taskId, sourcePath),
  removeFile: (taskId, fileName) => ipcRenderer.send('att:remove', taskId, fileName),
  resolveAttachment: (taskId, fileName) => ipcRenderer.invoke('att:resolve', taskId, fileName),
  openAttachment: (taskId, fileName) => ipcRenderer.send('att:open', taskId, fileName),
  revealAttachment: (taskId, fileName) => ipcRenderer.send('att:reveal', taskId, fileName),
  revealAttFolder: () => ipcRenderer.send('att:reveal-folder'),
  quickLook: (taskId, fileName) => ipcRenderer.send('ql:preview', taskId, fileName),
  dismissQuickLook: () => ipcRenderer.send('ql:dismiss'),
  showHeaderMenu: () => ipcRenderer.send('show-header-menu'),
  openFile: (filePath) => ipcRenderer.send('open-file', filePath),
  revealFile: (filePath) => ipcRenderer.send('reveal-file', filePath),
  fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  loadSettings: () => ipcRenderer.invoke('settings:load'),
  setSettings: (s) => ipcRenderer.send('settings:set', s),
  onSettingsChanged: (callback) => ipcRenderer.on('settings-changed', (_event, s) => callback(s))
});
