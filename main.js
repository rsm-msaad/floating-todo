const { app, BrowserWindow, ipcMain, screen, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;

// Edge-tuck state
let isTucked = false;
let tuckSide = null;          // 'left' | 'right'
let preTuckBounds = null;     // bounds before tucking
let tuckMoveTimer = null;     // debounce timer for 'moved'
let untuckCooldown = false;   // suppress re-tuck after restore

const TUCK_EDGE_PX = 28;
const TAB_W = 20;
const TAB_H = 88;

function tasksFile() {
  return path.join(app.getPath('userData'), 'tasks.json');
}

function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
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
    // Never persist the tiny tab bounds — store the real window bounds.
    const bounds = isTucked ? preTuckBounds : win.getBounds();
    fs.writeFileSync(stateFile(), JSON.stringify(bounds));
  } catch (err) {
    // position is a nice to have, never block on it
  }
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

  // Nudge inward so the window doesn't land back in the tuck zone.
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

  // Suppress re-tuck for 900ms so the 'moved' event from the animated
  // restore doesn't immediately tuck the window again.
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

  // Float above normal windows, and follow you onto every Space and fullscreen app.
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.on('moved', () => { saveState(); onWindowMoved(); });
  win.on('resized', saveState);
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    // No Dock icon, no Cmd+Tab entry. It behaves like an overlay.
    app.dock.hide();
  }
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

ipcMain.handle('tasks:load', () => {
  try {
    return JSON.parse(fs.readFileSync(tasksFile(), 'utf8'));
  } catch (err) {
    return [];
  }
});

ipcMain.on('show-task-menu', (event, id, priority) => {
  const send = (action) => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('task-menu-choice', { id, action });
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

  menu.popup({ window: win });
});

ipcMain.on('tasks:save', (event, items) => {
  try {
    fs.writeFileSync(tasksFile(), JSON.stringify(items));
  } catch (err) {
    // best-effort
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
