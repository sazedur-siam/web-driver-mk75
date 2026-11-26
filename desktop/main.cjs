/**
 * MK75 Driver desktop app: the web app (../dist) in a tray app, so live effects and music sync keep running
 * with no browser open. Same code as the website; this file only adds what a browser tab can't do.
 */
const { app, BrowserWindow, Menu, Tray, desktopCapturer, nativeImage, net, protocol, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const WEB = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'dist');
const ORIGIN = 'app://mk75';
const SMOKE = process.argv.includes('--smoke'); // `npm run smoke`: load the page, print a self-check, quit

let win = null;
let tray = null;
let quitting = false;

// WebHID needs a secure context, so serve dist/ from a privileged scheme instead of file://.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, serviceWorkers: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => show());
app.on('activate', () => show());
app.on('before-quit', () => (quitting = true));

function show() {
  if (!win) return;
  win.show();
  win.focus();
}

function serve() {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.join(WEB, decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(WEB + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function permissions() {
  const ses = session.defaultSession;
  const ours = (origin) => typeof origin === 'string' && origin.startsWith(ORIGIN);
  // Only our own page is ever loaded; it asks for MK75 filters only. Grant it HID, notifications and capture.
  ses.setPermissionCheckHandler((_wc, _perm, origin) => ours(origin));
  ses.setPermissionRequestHandler((wc, _perm, cb) => cb(ours(wc.getURL())));
  ses.setDevicePermissionHandler((d) => d.deviceType === 'hid' && ours(d.origin));
  // No chooser in Electron: take the first matching device (cable and receiver at once: the cable wins by order).
  ses.on('select-hid-device', (e, details, cb) => {
    e.preventDefault();
    cb(details.deviceList[0]?.deviceId ?? '');
  });
  // Music / screen sync: answer getDisplayMedia with the main screen and system audio, no share dialog.
  // shortcut: audio loopback is Windows-only here; macOS needs ScreenCaptureKit audio or a virtual device.
  ses.setDisplayMediaRequestHandler(async (req, cb) => {
    const [screen] = await desktopCapturer.getSources({ types: ['screen'] });
    cb({ video: screen, audio: req.audioRequested && process.platform === 'win32' ? 'loopback' : undefined });
  });
}

function createWindow(visible) {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    show: visible,
    title: 'MK75 Driver',
    icon: path.join(WEB, 'icon-512.png'),
    autoHideMenuBar: true,
    webPreferences: { backgroundThrottling: false }, // live effects must not slow down while hidden
  });
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault(); // closing hides to the tray; Quit is in the tray menu
    win.hide();
  });
  const external = (url) => /^https:\/\//.test(url) && void shell.openExternal(url);
  win.webContents.setWindowOpenHandler(({ url }) => {
    external(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN)) return;
    e.preventDefault();
    external(url);
  });
  void win.loadURL(`${ORIGIN}/`);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(WEB, 'icon-192.png')).resize({ width: 18, height: 18 }));
  tray.setToolTip('MK75 Driver');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open MK75 Driver', click: show },
      {
        label: 'Start at login',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.on('click', show);
}

async function smoke() {
  const timer = setTimeout(() => app.exit(1), 20_000);
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  const r = await win.webContents.executeJavaScript(
    `({ origin: location.origin, secure: isSecureContext, hid: 'hid' in navigator, title: document.title, app: !!document.querySelector('.app') })`,
  );
  console.log(JSON.stringify(r));
  clearTimeout(timer);
  app.exit(r.secure && r.hid && r.app ? 0 : 1);
}

app.whenReady().then(() => {
  serve();
  permissions();
  const hidden = SMOKE || process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin;
  createWindow(!hidden);
  if (SMOKE) return void smoke();
  createTray();
});
