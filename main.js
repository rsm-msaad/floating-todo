const { app, BrowserWindow, ipcMain, screen, Menu, Tray, dialog, shell, globalShortcut } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let qlProcess = null;

let win = null;
let detailWin = null;
let tray = null;
let items = [];
let settings = { fontScale: 1 };

// Edge-tuck state
let isTucked = false;
let tuckSide = null;
let preTuckBounds = null;
let tuckMoveTimer = null;
let untuckCooldown = false;

const TUCK_EDGE_PX = 28;
const TAB_W = 20;
const TAB_H = 88;

// ── Attachment storage helpers ────────────────────────────

function attachmentsBaseDir() {
  return path.join(app.getPath('userData'), 'attachments');
}

function taskAttDir(taskId) {
  return path.join(attachmentsBaseDir(), String(taskId));
}

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (err) {}
}

function uniqueFileName(dir, name) {
  let candidate = name;
  let counter = 1;
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  while (fs.existsSync(path.join(dir, candidate))) {
    counter++;
    candidate = base + '-' + counter + ext;
  }
  return candidate;
}

function copyFileToStore(taskId, sourcePath) {
  const dir = taskAttDir(taskId);
  ensureDir(dir);
  const originalName = path.basename(sourcePath);
  const fileName = uniqueFileName(dir, originalName);
  fs.copyFileSync(sourcePath, path.join(dir, fileName));
  return { name: originalName, file: fileName };
}

function removeStoredFile(taskId, fileName) {
  try { fs.unlinkSync(path.join(taskAttDir(taskId), fileName)); } catch (err) {}
}

function removeTaskAttDir(taskId) {
  try { fs.rmSync(taskAttDir(taskId), { recursive: true, force: true }); } catch (err) {}
}

function resolveAttachment(taskId, fileName) {
  const p = path.join(taskAttDir(taskId), fileName);
  try { return { path: p, exists: fs.existsSync(p) }; } catch (err) { return { path: p, exists: false }; }
}

function migrateAttArray(attArray, taskId) {
  let changed = false;
  for (const att of attArray) {
    if (att.path && !att.file) {
      try {
        if (fs.existsSync(att.path)) {
          const result = copyFileToStore(taskId, att.path);
          att.name = result.name;
          att.file = result.file;
        } else {
          att.file = '';
        }
      } catch (err) {
        att.file = '';
      }
      delete att.path;
      changed = true;
    }
  }
  return changed;
}

function migrateAllAttachments() {
  let changed = false;
  for (const item of items) {
    if (item.attachments) changed = migrateAttArray(item.attachments, item.id) || changed;
    if (item.subtasks) {
      for (const sub of item.subtasks) {
        if (sub.attachments) changed = migrateAttArray(sub.attachments, item.id) || changed;
        if (sub.children) {
          for (const child of sub.children) {
            if (child.attachments) changed = migrateAttArray(child.attachments, item.id) || changed;
          }
        }
      }
    }
  }
  if (changed) saveTasks();
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    settings = { fontScale: 1, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch (err) {
    settings = { fontScale: 1 };
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(settings));
  } catch (err) {}
}

function broadcastSettings() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      w.webContents.send('settings-changed', settings);
    }
  }
}

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

  // Clamp saved position so the window never opens off-screen
  if (saved) {
    saved.x = Math.max(area.x, Math.min(saved.x, area.x + area.width - saved.width));
    saved.y = Math.max(area.y, Math.min(saved.y, area.y + area.height - saved.height));
  }

  // Prevent auto-tuck during startup positioning
  untuckCooldown = true;
  setTimeout(() => { untuckCooldown = false; }, 1200);

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

// ── Tray & window toggle ──────────────────────────────────

function toggleMainWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (detailWin && !detailWin.isDestroyed()) {
    detailWin.close();
    return;
  }
  if (isTucked) {
    untuck();
    win.show();
    win.focus();
    return;
  }
  if (win.isVisible()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
}

function createTray() {
  const iconPath = path.join(__dirname, 'trayTemplate.png');
  tray = new Tray(iconPath);
  tray.setToolTip('Checklist');

  tray.on('click', () => toggleMainWindow());

  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Show Checklist', click: () => {
        if (!win || win.isDestroyed()) { createWindow(); return; }
        if (isTucked) untuck();
        win.show();
        win.focus();
      }},
      { type: 'separator' },
      { label: 'Reveal attachments folder', click: () => {
        const dir = attachmentsBaseDir();
        ensureDir(dir);
        shell.openPath(dir);
      }},
      { type: 'separator' },
      { role: 'quit' }
    ]);
    tray.popUpContextMenu(menu);
  });
}

function setupAppMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Close Window', accelerator: 'CmdOrCtrl+W', click: () => {
          const focused = BrowserWindow.getFocusedWindow();
          if (focused && focused === detailWin) {
            detailWin.close();
          }
        }}
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }
  loadSettings();
  loadTasks();
  migrateAllAttachments();
  setupAppMenu();
  createWindow();
  createTray();

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
  removeTaskAttDir(id);
  items = items.filter((i) => i.id !== id);
  saveTasks();
  broadcastTasks();
});

ipcMain.on('tasks:reorder', (event, orderedIds) => {
  const map = new Map(items.map((i) => [i.id, i]));
  const reordered = orderedIds.map((id) => map.get(id)).filter(Boolean);
  // append any items not in the list (safety net)
  for (const i of items) {
    if (!orderedIds.includes(i.id)) reordered.push(i);
  }
  items = reordered;
  saveTasks();
  broadcastTasks();
});

ipcMain.on('tasks:clear-done', () => {
  const doneItems = items.filter((i) => i.done);
  for (const d of doneItems) removeTaskAttDir(d.id);
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
      removeTaskAttDir(id);
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

ipcMain.handle('att:copy', (event, taskId, sourcePath) => {
  try {
    return copyFileToStore(taskId, sourcePath);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.on('att:remove', (event, taskId, fileName) => {
  removeStoredFile(taskId, fileName);
});

ipcMain.handle('att:resolve', (event, taskId, fileName) => {
  return resolveAttachment(taskId, fileName);
});

ipcMain.on('att:open', (event, taskId, fileName) => {
  const { path: p, exists } = resolveAttachment(taskId, fileName);
  if (exists) shell.openPath(p);
});

ipcMain.on('att:reveal', (event, taskId, fileName) => {
  const { path: p, exists } = resolveAttachment(taskId, fileName);
  if (exists) shell.showItemInFolder(p);
});

ipcMain.on('att:reveal-folder', () => {
  const dir = attachmentsBaseDir();
  ensureDir(dir);
  shell.openPath(dir);
});

// ── Quick Look ────────────────────────────────────────────

ipcMain.on('ql:preview', (event, taskId, fileName) => {
  try {
    if (qlProcess) { try { qlProcess.kill(); } catch (err) {} qlProcess = null; }
    const { path: p, exists } = resolveAttachment(taskId, fileName);
    console.log('[QuickLook] path:', p, 'exists:', exists);
    if (!exists) return;
    qlProcess = spawn('qlmanage', ['-p', p], { stdio: 'ignore' });
    qlProcess.on('exit', (code) => {
      console.log('[QuickLook] qlmanage exited with code:', code);
      qlProcess = null;
    });
    qlProcess.on('error', (err) => {
      console.log('[QuickLook] spawn error:', err.message);
      qlProcess = null;
    });
  } catch (err) {
    console.log('[QuickLook] error:', err.message);
  }
});

ipcMain.on('ql:dismiss', () => {
  console.log('[QuickLook] dismiss, process:', !!qlProcess);
  try { if (qlProcess) { qlProcess.kill(); qlProcess = null; } } catch (err) {}
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

// ── Header context menu ──────────────────────────────────

ipcMain.on('show-header-menu', (event) => {
  const menu = Menu.buildFromTemplate([
    { label: 'Reveal attachments folder', click: () => {
      const dir = attachmentsBaseDir();
      ensureDir(dir);
      shell.openPath(dir);
    }}
  ]);
  const w = BrowserWindow.fromWebContents(event.sender);
  menu.popup({ window: w });
});

ipcMain.handle('open-external', async (event, url) => {
  try {
    const parsed = new URL(url);
    const allowed = ['http:', 'https:', 'mailto:', 'message:'];
    if (!allowed.includes(parsed.protocol)) return false;
    await shell.openExternal(url);
    return true;
  } catch (err) {
    return false;
  }
});

// ── Settings ───────────────────────────────────────────────

ipcMain.handle('settings:load', () => {
  return settings;
});

ipcMain.on('settings:set', (event, updated) => {
  settings = { ...settings, ...updated };
  saveSettings();
  broadcastSettings();
});

// ── Migration support ──────────────────────────────────────

ipcMain.on('tasks:migrate', (event, migrated) => {
  items = migrated;
  saveTasks();
  broadcastTasks();
});

app.on('window-all-closed', () => {
  // With a tray icon, don't quit when windows are closed/hidden on macOS
  if (process.platform !== 'darwin') app.quit();
});
