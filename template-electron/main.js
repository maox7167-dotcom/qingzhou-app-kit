/**
 * 壹万柒客服考试系统 —— Electron 主进程
 * 策略：零侵入封装。把 resources 里的 server.js / app.html / data.json
 *       拷贝到用户可写目录(userData)，再在主进程内 require 启动后端 HTTP 服务，
 *       前端通过 localhost 访问，代码一行不改。
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');

const isPack = app.isPackaged;
const RES = isPack
  ? path.join(process.resourcesPath, 'resources')
  : path.join(__dirname, 'resources');
const APP_DATA_ROOT = app.getPath('appData');
// 数据目录固定用英文名，产品改名也不会让历史成绩"消失"
const USER = path.join(APP_DATA_ROOT, 'QingzhouHR');
app.setPath('userData', USER);
const APP_NAME = '轻舟AI V1.0.0 · 培训考核系统';
const LEGACY_DIRS = ['壹万柒客服考试系统', 'ywx-exam-desktop'];
// 内置推理服务程序的版本号，换了新版 llama.cpp 才需要改这个值（会触发重新释放）
const LLAMA_VERSION = 'b12184-vulkan';
const LLAMA_DIR = path.join(USER, 'llama');

// 单实例锁：避免重复打开多个窗口
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  const w = BrowserWindow.getFocusedWindow();
  if (w) { w.show(); w.focus(); }
});

// 把资源拷贝到用户目录（server.js / app.html 每次覆盖以跟随更新；data.json 仅首次）
function copyIf(src, dst, force) {
  try { if (force || !fs.existsSync(dst)) fs.copyFileSync(src, dst); } catch (e) { console.error('拷贝失败', src, e); }
}
function migrateLegacyData() {
  const dst = path.join(USER, 'data.json');
  if (fs.existsSync(dst)) return;
  for (const name of LEGACY_DIRS) {
    const src = path.join(APP_DATA_ROOT, name, 'data.json');
    if (fs.existsSync(src)) {
      try { fs.copyFileSync(src, dst); console.log('已迁移历史成绩数据:', src); } catch (e) { console.error('迁移失败', e); }
      return;
    }
  }
}
/* 释放内置的推理服务程序（llama-server.exe + dll）。
   客户机不用装 llama.cpp、不用解压、不用配环境变量，这是最容易翻车的一步，安装包直接带。
   只在首次或版本变化时拷，之后启动零开销。 */
function prepareLlama() {
  const src = path.join(RES, 'llama');
  if (!fs.existsSync(src)) return;                 // 便携版没带就跳过，退回"用户自己放"的老逻辑
  const stamp = path.join(LLAMA_DIR, '.version');
  try {
    if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === LLAMA_VERSION) return;
  } catch (e) {}
  const t0 = Date.now();
  try {
    fs.mkdirSync(LLAMA_DIR, { recursive: true });
    let n = 0;
    for (const f of fs.readdirSync(src)) {
      try { fs.copyFileSync(path.join(src, f), path.join(LLAMA_DIR, f)); n++; }
      catch (e) { console.error('释放失败', f, e.message); }
    }
    fs.writeFileSync(stamp, LLAMA_VERSION);
    console.log('已释放内置推理服务程序 ' + n + ' 个文件（' + (Date.now() - t0) + 'ms）→ ' + LLAMA_DIR);
  } catch (e) {
    console.error('释放内置服务程序失败:', e);
  }
}

function prepareUserData() {
  try { fs.mkdirSync(USER, { recursive: true }); } catch (e) { console.error(e); }
  migrateLegacyData();
  prepareLlama();
  // 告诉 server.js 内置程序在哪，扫描模型时找不到就自动用它
  process.env.YWX_LLAMA_DIR = LLAMA_DIR;
  copyIf(path.join(RES, 'server.js'), path.join(USER, 'server.js'), true);
  copyIf(path.join(RES, 'app.html'), path.join(USER, 'app.html'), true);
  ['manifest.json', 'sw.js', 'icon-192.png', 'icon-512.png'].forEach(function (n) {
    copyIf(path.join(RES, n), path.join(USER, n), true);
  });
  if (!fs.existsSync(path.join(USER, 'data.json'))) {
    copyIf(path.join(RES, 'data.default.json'), path.join(USER, 'data.json'), false);
  }
}

// 优先用固定端口（同事访问地址才稳定），被占用则向上顺延，全占满才退回随机
const PREFERRED_PORT = Number(process.env.QZ_PORT || 3000);
function findFreePort() {
  return new Promise((res) => {
    const s = net.createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
  });
}
function probePort(p) {
  return new Promise((res) => {
    const s = net.createServer();
    s.once('error', () => res(false));
    s.listen(p, '0.0.0.0', () => s.close(() => res(true)));
  });
}
async function pickPort() {
  for (let p = PREFERRED_PORT; p < PREFERRED_PORT + 20; p++) {
    if (await probePort(p)) return p;
  }
  return await findFreePort();
}

// 轮询后端直到返回 200
function waitReady(port, timeout = 20000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, (r) => { clearInterval(iv); res(); });
      req.on('error', () => {
        if (Date.now() - t0 > timeout) { clearInterval(iv); rej(new Error('后端启动超时')); }
      });
    }, 300);
  });
}

let mainWindow = null;
function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: '#0e1230',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.loadURL('http://127.0.0.1:' + port + '/');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

let booted = false;
async function boot() {
  if (booted) return;
  booted = true;
  prepareUserData();
  const port = await pickPort();
  process.env.PORT = String(port);
  try {
    // server.js 顶层会执行 server.listen(PORT)，在主进程内启动后端
    require(path.join(USER, 'server.js'));
  } catch (e) {
    console.error('后端启动失败:', e);
  }
  try {
    await waitReady(port);
  } catch (e) {
    console.error(e.message);
  }
  createWindow(port);
}

app.whenReady().then(boot);
app.on('window-all-closed', () => { app.quit(); });
