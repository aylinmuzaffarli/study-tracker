const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'logo.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Force Electron to use your icon
  win.setIcon(path.join(__dirname, 'logo.ico'));

  win.loadFile('index.html');
}



// Forces Windows to register the unique icon on the taskbar instead of using a generic default
if (process.platform === 'win32') {
  app.setAppUserModelId("com.tracking.system");
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});