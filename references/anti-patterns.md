# 23 条实战踩坑清单

按「会浪费多少时间」排序。前 8 条每条都曾让人排查半天以上。

---

## 一、路径与目录（最容易连环出错）

### 1. 中文路径混用 `cd ... &&` 和 `;`

```bash
# ❌ 错误：目录改名后 cd 失败，但分号后面的命令照跑，文件落到当前工作目录
cd "C:/Users/x/Desktop/轻舟HR3.0" && cp a.txt . ; cp b.txt .

# ✅ 正确：绝对路径存变量，一次性引用
D="C:/Users/x/Desktop/轻舟3.2/3.0.9"
cp "$D/a.txt" "$D/app/"
```

`&&` 在 `cd` 失败时会中断，`;` 不会。混合使用就会出现「文件凭空消失」，实际是被写到了上一个工作目录。

**规则：所有多目录操作用 shell 变量存绝对路径，不要 `cd` 到中文目录再操作。**

### 2. 目录移动前不杀 node 进程

`server.js` 用 `__dirname` 定位 `data.json`。进程跑着的时候移目录，它会按**旧路径**继续写，结果是：
- 新目录里没有数据
- 旧路径被重建出一个空库
- 看起来像「数据全丢了」

**移动 / 重命名目录前先 `netstat -ano | grep :3000`，杀掉监听进程。**

### 3. 用可视化页面编辑器打开单文件 HTML

某些「可视化编辑」工具会在 HTML 里注入 `data-page-node-id`，并重写内联样式（字号、颜色变杂）。单文件项目里这份 HTML 就是程序本体，被注入一次整个视觉就废了。

**规则：单文件 HTML 只用代码工具（Read/Edit/脚本）改，永远不要用可视化编辑器打开。**

### 4. 打包前忘记同步 resources

Electron 工程里的 `resources/app.html` 是**副本**。改了主文件不拷过去，打出来的 exe 里是旧界面——而且 exe 能正常运行，只是看起来「我的改动没生效」，极易误判成打包缓存问题。

**规则：打包前跑一次 `md5sum 主文件 resources/app.html`，两值必须相同。**

---

## 二、Electron 与进程

### 5. `ELECTRON_RUN_AS_NODE` 让 exe 当 node 跑

环境里如果存在这个变量，Electron 会退化成纯 Node，执行完 `main.js` 就退出——表现为「双击闪一下没了」「窗口不出现但日志正常」。

```bash
# 启动前清掉
env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS ./app.exe
```

打包产物给客户时没这个问题；只有在开发机/CI 环境里才容易撞上。

### 6. `tasklist | grep 中文` 在 Git Bash 里不可靠

`tasklist` 在 Windows 中文系统输出 GBK，Git Bash 按 UTF-8 读，中文进程名匹配不上。**查进程一律用 PowerShell：**

```powershell
Get-Process | Where-Object { $_.ProcessName -like "*关键字*" } | Select-Object Id, ProcessName, MainWindowTitle
```

不要用 `tasklist | grep 轻舟` 判断进程死活，会得到错误结论。

### 7. bash 前台跑 GUI 进程会随会话结束被杀

`./app.exe` 在命令里跑，工具在命令结束时会回收整个进程树。看到的是「日志打印完整 → 6 秒后退出」，很容易误以为程序有 bug。

**验证 exe 是否真能跑，用 Node 脚本托管：**

```js
const { spawn } = require('child_process');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const p = spawn(EXE, [], { env });
// 轮询端口，拿到 200 再 kill
```

### 8. 单实例锁让第二个实例静默退出

`app.requestSingleInstanceLock()` 失败就直接 `app.quit()`，**没有任何输出**。表现为「双击没反应」。

排查：先确认没有残留窗口、任务管理器里没有同名进程，再怀疑单实例锁。

### 9. exe 读的是 userData 副本，不是app

首次启动会把 `resources/` 拷到 `%APPDATA%\<产品名>\`。之后：
- 改 `app\data.json` **不影响** exe
- 卸载重装**不会**清数据
- 客户「改了配置没生效」通常是改错了地方

**使用说明里必须写清两个数据位置，并且不要把 userData 目录名跟产品名绑定**（产品改名会导致老客户数据「消失」）。

---

## 三、数据层

### 10. 数组属性不会被 JSON 序列化

```js
const plans = [];
plans.best = 'local-17';          // ❌ 序列化后消失
JSON.stringify(plans);            // → "[]"
```

**要给集合带元信息，用对象包一层：`{ list: [...], best: 'x' }`。**

### 11. 容量阈值按标称值写会误杀

客户说 16G 内存，系统读到 15.9G。阈值写 `>= 16` 会把该升档的机器判成不够。

**阈值向下取整：16G 档判断 `>= 15`，12G 档 `>= 11.5`，8G 档 `>= 7.5`。**

### 12. `data.json` 里存了 API Key

设置页保存的 `apiKey` 会跟着数据一起进 `data.json`。如果这个文件被打进安装包（作为 default 数据），**你的密钥就随 exe 发给了每一个客户**。

**规则：打包前必跑 `sanitize_check.py`；`data.default.json` 里的 `apiKey` 必须是空字符串。**

### 13. 不做原子写，断电得到半个文件

```js
// ✅ 正确
fs.writeFileSync(tmp, json);
fs.renameSync(tmp, real);

// ❌ 错误：写到一半断电 = 数据全废
fs.writeFileSync(real, json);
```

同时必须有 `rev` 递增，前端靠它判断数据有没有变。

---

## 四、前端与视觉

### 14. 引入 Google Fonts / CDN 导致内网白屏

客户内网连不上 `fonts.googleapis.com`，浏览器会等到超时才渲染文本。表现是「打开一片白，三十秒后才出来」。

**规则：字体只用系统字体栈，图标用内联 SVG 或 Unicode 符号，零外链。**

### 15. 内联 `repeat(4,1fr)` 的统计卡在手机上溢出

写死在行内样式里的四列网格，窄屏不会自动换行，直接把页面撑宽。

**修法：`@media` 里用 `!important` 覆盖，或对容器加 `overflow-x:auto`。**

### 16. 表格没有滚动容器 → 整页横向溢出

`<table>` 最小宽度由内容决定。塞进窄屏卡片时，撑破的是 `body`。

**修法：`.card:has(table){overflow-x:auto}` + `table{min-width:520px}`。**

### 17. `.card h3::before` 已被占用时加装饰会错位

老样式常把 `::before` 留给行内 emoji/图标占位。再加一道装饰竖条，会跟原内容挤在一起。

**修法：显式 `content:""; display:block;` 接管，或改用 `::after` / `border-left`。**

### 18. 触屏上 hover 光斑会常驻成色块

`@media(hover:hover)` 之外写的 `:hover::after` 高亮，触屏设备在点击后会让状态卡住，看起来像「卡片上多了一块莫名的绿色方块」。

**修法：`@media(hover:none){ .x:hover::after{display:none} }`。**

### 19. 固定 `waitForTimeout` 截图时机不稳

页面有入场动画时，固定等 1.5 秒可能截到半透明的中间态，误判成「样式没生效」。

**修法：`await page.waitForSelector('#目标元素', {state:'visible'})` 再截。**

---

## 五、AI 与网络

### 20. GitHub 直连下载只有 40KB/s

模型/二进制从 GitHub Releases 直连，国内实测 40KB/s，1GB 要下 7 小时。

**修法：加 `https://gh-proxy.com/` 前缀，或改用 ModelScope 直链（免登录、速度稳定）。**

### 21. 流式下载不做 Range 就断了没法续

客户断网后重下从头开始，几百 MB 白费。

**修法：请求带 `Range: bytes=<已下载>-`，服务端返回 206 时追加写；同时用文件大小做完整性校验。**

### 22. 本地模型首次响应超时会让人以为坏了

0.6B 模型在纯 CPU 上首次推理要 10 秒以上（含模型加载）。前端超时设 30 秒，用户等 5 秒就以为卡死。

**修法：加进度提示文案（「首次加载模型较慢，约 10–30 秒」），并在页面明确显示当前引擎。**

---

## 六、测试

### 23. 单测点按钮会按 DOM 重读配置，覆盖掉你刚设的值

前端常写「点击时 `syncMix()` 从输入框重读配比」。单测里直接改 JS 变量再点按钮，会被 DOM 里的旧值覆盖回去，测试永远失败。

**修法：给 input 赋值后 `dispatchEvent(new Event('input'))`；或直接在测试里操作 DOM 元素。**

---

## 交付前快速自查（复制粘贴用）

```bash
# 1. 外链检查
grep -oE "https?://[a-zA-Z0-9.-]+" app.html | sort -u | grep -v "localhost\|127.0.0.1"

# 2. 敏感信息
grep -rnE "sk-[a-zA-Z0-9]{20,}|qyapi\.weixin|aHR0cHM6" .

# 3. 版本号一致性
grep -o "APP_VER='[^']*'" app.html; grep '"version"' ../electron/package.json

# 4. 打包前资源同步
md5sum app.html ../electron/resources/app.html
```
