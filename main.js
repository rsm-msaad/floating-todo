const { app, BrowserWindow, ipcMain, screen, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let detailWin = null;
let items = [];

// Edge-tuck state
let isTucked = false;
let tuckSide = null;
let preTuckBounds = null;
let tuckMoveTimer = null;
let untuckCooldown = false;

const TUCK_EDGE_PX = 28;
const TAB_W = 20;
const TAB_H = 88;

function tasksFile() {
  return path.join(app.getPath('userData'), 'tasks.json');
}

function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadTasks() {
  try {
    items = JSON.parse(fs.readFileSync(tasksFile(), 'utf8'));
  } catch (err) {
    items = [];
  }
}

function saveTasks() {
  try {
    fs.writeFileSync(tasksFile(), JSON.stringify(items));
  } catch (err) {
    // best-effort
  }
}

function broadcastTasks() {
  const allWindows = BrowserWindow.getAllWindows();
  for (const w of allWindows) {
    if (!w.isDestroyed()) {
      w.webContents.send('tasks-changed', items);
    }
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch (err) {
    return null;
  }
}

function saveState() {
  if (!win || win.isDestroyed()) return;
  try {
    const bounds = isTucked ? preTuckBounds : win.getBounds();
    fs.writeFileSync(stateFile(), JSON.stringify(bounds));
  } catch (err) {}
}

function sendTuckState() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('tuck-state', { tucked: isTucked, side: tuckSide });
}

function tuck(side) {
  if (isTucked || !win || win.isDestroyed()) return;

  const bounds = win.getBounds();
  preTuckBounds = { ...bounds };
  isTucked = true;
  tuckSide = side;

  const area = screen.getPrimaryDisplay().workArea;
  const tabY = Math.round(bounds.y + bounds.height / 2 - TAB_H / 2);

  win.setResizable(false);
  win.setMinimumSize(TAB_W, TAB_H);
  win.setBounds({
    x: side === 'left' ? area.x : area.x + area.width - TAB_W,
    y: tabY,
    width: TAB_W,
    height: TAB_H
  }, true);

  sendTuckState();
  saveState();
}

function untuck() {
  if (!isTucked || !win || win.isDestroyed()) return;

  const area = screen.getPrimaryDisplay().workArea;
  const b = { ...preTuckBounds };

  if (tuckSide === 'left') {
    b.x = Math.max(area.x + TUCK_EDGE_PX + 4, b.x);
  } else {
    b.x = Math.min(area.x + area.width - b.width - TUCK_EDGE_PX - 4, b.x);
  }

  isTucked = false;
  tuckSide = null;
  preTuckBounds = null;

  win.setMinimumSize(240, 150);
  win.setResizable(true);
  win.setBounds(b, true);

  sendTuckState();
  saveState();

  untuckCooldown = true;
  setTimeout(() => { untuckCooldown = false; }, 900);
}

function onWindowMoved() {
  if (isTucked || untuckCooldown || !win || win.isDestroyed()) return;

  clearTimeout(tuckMoveTimer);
  tuckMoveTimer = setTimeout(() => {
    if (isTucked || untuckCooldown || !win || win.isDestroyed()) return;

    const bounds = win.getBounds();
    const area = screen.getPrimaryDisplay().workArea;
    const distLeft = bounds.x - area.x;
    const distRight = (area.x + area.width) - (bounds.x + bounds.width);

    if (distLeft <= TUCK_EDGE_PX) {
      tuck('left');
    } else if (distRight <= TUCK_EDGE_PX) {
      tuck('right');
    }
  }, 220);
}

function createWindow() {
  const saved = loadState();
  const area = screen.getPrimaryDisplay().workArea;
  const defaultHeight = saved && saved.height > 120 ? saved.height : 380;

  win = new BrowserWindow({
    width: saved ? saved.width : 300,
    height: defaultHeight,
    x: saved ? saved.x : area.x + area.width - 340,
    y: saved ? saved.y : area.y + 60,
    minWidth: 240,
    minHeight: 150,
    maxWidth: 640,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.on('moved', () => { saveState(); onWindowMoved(); });
  win.on('resized', saveState);
}

function showMainWindow() {
  if (!win || win.isDestroyed() || win.isVisible()) return;
  win.show();
}

function hideMainWindow() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  win.hide();
}

function openDetail(taskId) {
  const item = items.find((i) => i.id === taskId);
  if (!item) return;

  if (detailWin && !detailWin.isDestroyed()) {
    detailWin.webContents.send('show-task', item);
    detailWin.show();
    detailWin.focus();
    hideMainWindow();
    return;
  }

  const mainBounds = win && !win.isDestroyed() ? win.getBounds() : null;
  const area = screen.getPrimaryDisplay().workArea;
  const dw = 420;
  const dh = 480;
  let dx, dy;
  if (mainBounds) {
    dx = Math.round(mainBounds.x + mainBounds.width / 2 - dw / 2);
    dy = Math.round(mainBounds.y + mainBounds.height / 2 - dh / 2);
  } else {
    dx = Math.round(area.x + area.width / 2 - dw / 2);
    dy = Math.round(area.y + area.height / 2 - dh / 2);
  }

  detailWin = new BrowserWindow({
    width: dw,
    height: dh,
    x: dx,
    y: dy,
    minWidth: 320,
    minHeight: 300,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  detailWin.loadFile(path.join(__dirname, 'detail.html'));
  detailWin.setAlwaysOnTop(true, 'floating');
  detailWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  detailWin.webContents.once('did-finish-load', () => {
    if (!detailWin.isDestroyed()) {
      detailWin.webContents.send('show-task', item);
      hideMainWindow();
    }
  });

  detailWin.on('closed', () => {
    detailWin = null;
    showMainWindow();
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }
  loadTasks();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

ipcMain.on('quit-app', () => {
  saveState();
  app.quit();
});

ipcMain.on('untuck', () => {
  untuck();
});

// ── Tasks IPC ──────────────────────────────────────────────

ipcMain.handle('tasks:load', () => {
  return items;
});

ipcMain.on('tasks:add', (event, item) => {
  items.push(item);
  saveTasks();
  broadcastTasks();
});

ipcMain.on('tasks:update', (event, updated) => {
  const idx = items.findIndex((i) => i.id === updated.id);
  if (idx !== -1) {
    items[idx] = updated;
    saveTasks();
    broadcastTasks();
  }
});

ipcMain.on('tasks:delete', (event, id) => {
  items = items.filter((i) => i.id !== id);
  saveTasks();
  broadcastTasks();
});

ipcMain.on('tasks:clear-done', () => {
  items = items.filter((i) => !i.done);
  saveTasks();
  broadcastTasks();
});

ipcMain.on('open-detail', (event, taskId) => {
  openDetail(taskId);
});

ipcMain.on('close-detail', () => {
  if (detailWin && !detailWin.isDestroyed()) {
    detailWin.close();
  }
});

// ── Context menu ───────────────────────────────────────────

ipcMain.on('show-task-menu', (event, id, priority) => {
  const send = (action) => {
    if (action === 'delete') {
      items = items.filter((i) => i.id !== id);
    } else {
      const item = items.find((i) => i.id === id);
      if (item) {
        item.priority = action === 'clear' ? undefined : action;
      }
    }
    saveTasks();
    broadcastTasks();
  };

  const menu = Menu.buildFromTemplate([
    { label: 'Urgent', type: 'checkbox', checked: priority === 'urgent', click: () => send('urgent') },
    { label: 'Soon',   type: 'checkbox', checked: priority === 'soon',   click: () => send('soon') },
    { label: 'Later',  type: 'checkbox', checked: priority === 'later',  click: () => send('later') },
    { type: 'separator' },
    { label: 'Clear priority', enabled: !!priority, click: () => send('clear') },
    { type: 'separator' },
    { label: 'Delete task', click: () => send('delete') }
  ]);

  const w = BrowserWindow.fromWebContents(event.sender);
  menu.popup({ window: w });
});

// ── Attachments ────────────────────────────────────────────

ipcMain.handle('pick-files', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections']
  });
  if (result.canceled) return [];
  return result.filePaths.map((p) => ({ name: path.basename(p), path: p }));
});

ipcMain.on('open-file', (event, filePath) => {
  shell.openPath(filePath);
});

ipcMain.on('reveal-file', (event, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle('file-exists', (event, filePath) => {
  return fs.existsSync(filePath);
});

// ── Migration support ──────────────────────────────────────

ipcMain.on('tasks:migrate', (event, migrated) => {
  items = migrated;
  saveTasks();
  broadcastTasks();
});

app.on('window-all-closed', () => {
  app.quit();
});
