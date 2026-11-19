# Electron 零侵入封装与 Windows 打包

目标：把已经能跑的 Web 系统变成双击即用的 exe，**前端一行代码不改**。

## 1. 为什么叫「零侵入」

`main.js` 只做三件事：

```
① 把 resources/ 拷到 userData（首次启动，之后保留用户改动）
② require('./server.js') 起 HTTP 服务（选端口，3000 被占就 +1）
③ 开 BrowserWindow 指向 http://127.0.0.1:<port>
```

好处很直接：**Web 版和桌面版是同一份代码**。改完网页版直接重新打包，不存在「桌面版要单独适配」这种事。代价是包体大（86MB，因为塞了整个 Chromium），但客户不在乎。

## 2. 工程结构

```
electron/
├─ main.js            主进程（~170 行）
├─ preload.js         预加载（几乎为空，禁用 Node 集成）
├─ package.json       含 electron-builder 的 build 配置
├─ build/
│  ├─ icon.ico        应用图标（256×256，多尺寸内嵌）
│  └─ installer.ico   安装程序图标
└─ resources/         ← 打包时整目录塞进 asar 外的 resources
   ├─ app.html        前端副本（从 app/ 拷过来）
   ├─ server.js       后端副本
   ├─ data.default.json  干净初始库
   ├─ manifest.json / sw.js / icon-*.png
   └─ llama/          llama.cpp 二进制（可选，约 89MB）
```

## 3. main.js 关键实现

### 3.1 路径与数据目录

```js
const isPack = app.isPackaged;
const RES = isPack
  ? path.join(process.resourcesPath, 'resources')
  : path.join(__dirname, 'resources');

const APP_DATA_ROOT = app.getPath('appData');
// ⚠️ 固定英文名，产品改名也不动它——老客户的成绩和模型都在里面
const USER = path.join(APP_DATA_ROOT, 'QingzhouHR');
app.setPath('userData', USER);
```

**这一行是整份代码最不能动的地方。** 把 `QingzhouHR` 改成新产品名，等于让所有老客户「数据消失」。

### 3.2 首次释放资源

```js
function ensureResources(){
  os.mkdirSync(USER, { recursive: true });
  for (const f of ['app.html','server.js','manifest.json','sw.js','icon-192.png','icon-512.png']) {
    const dst = path.join(USER, f);
    if (!fs.existsSync(dst)) fs.copyFileSync(path.join(RES, f), dst);
  }
  // 数据只在不存在时初始化，绝不覆盖
  const data = path.join(USER, 'data.json');
  if (!fs.existsSync(data)) fs.copyFileSync(path.join(RES, 'data.default.json'), data);
}
```

三个「只在不存时才写」的判断缺一不可。任何一处写成无条件拷贝，客户升级版本就会丢数据。

### 3.3 内置推理程序的版本化释放

`llama/` 有 32 个文件、89MB，每次都拷太慢。用版本文件判断：

```js
const LLAMA_VERSION = 'b12184-vulkan';
const LLAMA_DIR = path.join(USER, 'llama');

function releaseBundledLlama(){
  const mark = path.join(LLAMA_DIR, '.version');
  if (fs.existsSync(mark) && fs.readFileSync(mark,'utf8').trim() === LLAMA_VERSION) return;
  fs.mkdirSync(LLAMA_DIR, { recursive: true });
  fs.cpSync(path.join(RES, 'llama'), LLAMA_DIR, { recursive: true });
  fs.writeFileSync(mark, LLAMA_VERSION);
}
```

实测 32 个文件 / 89MB 拷贝耗时 **204ms**，可以接受。换新版 llama.cpp 时只改 `LLAMA_VERSION` 就会重新释放。

### 3.4 端口顺延

```js
function pickPort(prefer, cb){
  const srv = net.createServer();
  srv.once('error', () => pickPort(prefer + 1, cb));
  srv.once('listening', () => { srv.close(() => cb(prefer)); });
  srv.listen(prefer, '0.0.0.0');
}
```

启动前通过环境变量把端口传给 `server.js`：

```js
process.env.PORT = String(port);
process.env.YWX_LLAMA_DIR = LLAMA_DIR;   // 让 server.js 能发现内置 exe
require(path.join(USER, 'server.js'));
```

### 3.5 窗口

```js
mainWindow = new BrowserWindow({
  width: 1440, height: 940, minWidth: 1024,
  title: APP_NAME,
  icon: path.join(__dirname, 'build/icon.ico'),
  webPreferences: { preload: path.join(__dirname,'preload.js'), nodeIntegration: false, contextIsolation: true }
});
mainWindow.once('ready-to-show', () => mainWindow.show());   // 避免白屏闪一下
mainWindow.loadURL('http://127.0.0.1:' + port);
```

**`show:false` + `ready-to-show`** 是必须的，否则客户会看到一秒白屏。

## 4. package.json 的 build 配置

```json
{
  "name": "your-app-desktop",
  "version": "3.4.0",
  "main": "main.js",
  "build": {
    "appId": "com.yourcompany.app",
    "productName": "产品名",
    "files": ["main.js", "preload.js"],
    "extraResources": [{ "from": "resources", "to": "resources" }],
    "win": {
      "icon": "build/icon.ico",
      "target": ["portable", "nsis"]
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "installerIcon": "build/installer.ico"
    },
    "directories": { "output": "dist" }
  }
}
```

关键点：

- `files` 只列代码，**不要把 `resources/` 写进去**（会被打进 asar）
- `resources/` 走 `extraResources`，打包后在 `resources/resources/`，用 `process.resourcesPath` 访问
- `portable` 产出免安装单 exe（推荐发给客户），`nsis` 产出安装包
- `oneClick: false` 让客户能选安装目录——默认的静默安装会让人以为「装到哪去了」

## 5. 打包命令

```bash
# 首次
cd electron && npm install

# 打包（配国内镜像，否则下载 electron 二进制会卡死）
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" \
ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" \
node node_modules/electron-builder/cli.js --win
```

**用 `cli.js` 直调而不是 `npx`**：某些安全软件会清掉 `node_modules/.bin` 里的符号链接，`npx electron-builder` 会报找不到命令，`node node_modules/electron-builder/cli.js` 永远能用。

产物（约 2 分钟）：

```
dist/
├─ 产品名 3.4.0.exe            免安装版（86MB）
├─ 产品名 Setup 3.4.0.exe      安装版（86MB）
└─ win-unpacked/               解包后的目录（可用来快速调试）
```

## 6. 图标

- 格式：`.ico`，**必须含 256×256**，否则 Windows 任务栏会模糊
- 用在线工具或 ImageMagick 把 PNG 转成多尺寸 ico：
  ```bash
  magick icon-512.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
  ```
- 安装程序图标单独一份 `installer.ico`，可以和主图标相同

## 7. 版本号必须五处同步

漏一处就会出现「界面显示 3.3.1、安装包叫 3.4.0」这种事。

| 位置 | 字段 |
|---|---|
| 前端 HTML | `const APP_VER='V3.4.0'` + 页脚 `<span id="verStamp">` |
| `server.js` | 启动日志、User-Agent 里的版本号 |
| `main.js` | `APP_NAME`（窗口标题） |
| `package.json` | `version`（决定 exe 文件名） |
| 使用说明 / README | 标题行、开发历程表 |

**打包前跑一次检查：**

```bash
grep -o "APP_VER='[^']*'" resources/app.html
grep '"version"' package.json
grep "APP_NAME = " main.js
```

## 8. 打包前必做的资源同步

`resources/app.html` 是副本。这是最常犯的错误：

```bash
PROJ="/path/to/项目/app"
R="electron/resources"
cp "$PROJ/app.html"           "$R/app.html"
cp "$PROJ/server.js"          "$R/server.js"
cp "$PROJ/manifest.json"      "$R/manifest.json"
cp "$PROJ/sw.js"              "$R/sw.js"
cp "$PROJ/icon-192.png"       "$R/icon-192.png"
cp "$PROJ/icon-512.png"       "$R/icon-512.png"
# ⚠️ 绝对不要覆盖 data.default.json

# 验证
md5sum "$PROJ/app.html" "$R/app.html"    # 两个 MD5 必须相同
```

## 9. exe 启动失败的四种原因

按出现频率排序：

### ① `ELECTRON_RUN_AS_NODE` 环境变量（开发机常见）

现象：双击闪一下就没了，或者命令行里跑完立刻返回，**没有窗口**。
验证：`echo $ELECTRON_RUN_AS_NODE`，有值就是它。
修复：启动时清掉该变量，或重启终端。

### ② 单实例锁被占（静默退出）

现象：双击完全没反应，无任何输出。
原因：`app.requestSingleInstanceLock()` 返回 false 直接 `app.quit()`。
验证：任务管理器里是否已有同名进程（含隐藏的）。
修复：结束残留进程；若进程已死仍失败，检查是否上一次崩溃留下了锁。

### ③ 端口全被占

现象：窗口打开但白屏 / 显示无法访问。
原因：`pickPort` 的 `listen` 回调没触发，或 `server.js` 启动失败但没传到主进程。
验证：看启动日志里实际端口，`netstat -ano | grep :3000`。
修复：把端口范围放宽到 3000–3010，并在窗口加载前先 ping 一次服务。

### ④ 杀毒软件拦截（发给客户后最常见）

现象：客户双击后进程出现又消失，或提示「文件已损坏」。
原因：未签名的 exe 被 360 / 火绒 / Windows Defender 拦。
修复：
- 给客户一份「添加信任 / 白名单」的操作截图
- 长期方案：买代码签名证书（约 1000 元/年）
- 临时方案：把 exe 用 `zip` 打包发过去，让客户解压后再运行（能绕过部分按扩展名拦截）

## 10. 分发包结构

```
产品名 3.4.0 发布包/
├─ 产品名 3.4.0.exe            免安装版
├─ 产品名 Setup 3.4.0.exe      安装版
├─ app/                    网页版本体（客户也可以不装 exe 直接用这个）
│  ├─ app.html
│  ├─ server.js
│  ├─ data.json                 ⚠️ 发客户前必须删掉或换成干净库
│  ├─ manifest.json / sw.js / icon-*.png
│  ├─ start.bat          双击启动 + 自动开浏览器
│  └─ README.md
├─ 第三方许可证/                llama.cpp MIT / Qwen3 Apache-2.0 / LLVM
└─ 使用说明.txt                 默认账号、数据位置、备份方式、常见问题
```

**使用说明里必须写清三件事**，否则客户第一天就会打电话：

1. 默认账号密码
2. 数据在哪（`%APPDATA%\<目录名>\data.json`），怎么备份（复制这一个文件）
3. 同事怎么访问（同一局域网，打开显示的 IP 地址，防火墙要点允许）

## 11. 每次发版的固定动作

```bash
# 1. 改五处版本号
# 2. 同步 resources（含 MD5 校验）
# 3. 打包
# 4. 验证：脚本托管启动 exe，轮询端口拿到 200
# 5. 归档：旧 exe 移进 旧版本/，新 exe 放根目录
# 6. 组装发布包 + 更新使用说明
# 7. 脱敏检查：data.json 里有没有你自己的 API Key
```

第 7 步最容易被跳过，也最致命——见 `anti-patterns.md` 第 12 条。
