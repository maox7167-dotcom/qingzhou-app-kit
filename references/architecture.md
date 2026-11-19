# 架构设计说明

这一层解释「为什么这样设计」，看完再动手改，能避开大部分结构性错误。

## 1. 整体取舍

| 决策 | 选了什么 | 放弃了什么 | 为什么值得 |
|---|---|---|---|
| 存储 | 单个 JSON 文件 | MySQL / SQLite | 备份 = 复制一个文件；客户自己能恢复；不用教客户装数据库 |
| 前端 | 原生 JS 单文件 | React / Vue | 双击 HTML 就能改；没有 `npm install`；客户机器上不存在构建产物 |
| 后端 | Node 内置模块 | Express / Koa | 零依赖，`node server.js` 就跑；打包体积小 |
| 通信 | HTTP 轮询 | WebSocket / SSE | 30 人场景够用；断线自动重连不用写；不会因为半开连接卡死 |
| 桌面 | Electron 壳 | Tauri / 原生 | 前端零改动；Windows 兼容性最好；缺点只是包大（86MB） |

实测边界（i5-10400F / 16G / SSD）：

- `data.json` 239KB / 227 道题 / 31 个账号 / 7 份答卷 → `/api/state` 响应 **18ms**
- 30 个客户端同时 2.5 秒轮询 → 服务端 CPU 占用 **< 3%**
- `data.json` 增长到 **8MB** 时，`JSON.parse` 每次约 60ms，仍可接受
- 超过 **20MB** 就该换 SQLite 了

## 2. 数据层的三个设计

### 2.1 结构：`rev` + `state`

```json
{
  "rev": 159,
  "state": {
    "ywx_users":     [],
    "ywx_questions": [],
    "ywx_scopes":    [],
    "ywx_exams":     [],
    "ywx_materials": [],
    "ywx_attempts":  [],
    "ywx_settings":  {}
  }
}
```

- `rev` 是全局版本号，**每次成功写入 +1**
- `state` 里每个字段是一个集合，字段名统一加前缀（示例用 `ywx_`）避免和内部字段撞名
- 前端拉全量，靠 `rev` 判断有没有变化；变了才重渲染

**为什么不用增量同步？** 30 人场景下全量只有 239KB，gzip 后 40KB，2.5 秒一次完全无压力。增量同步要处理乱序、重放、冲突，复杂度翻十倍，收益在这个规模下是负的。

### 2.2 写入：按 id 合并，不整包覆盖

这是最容易做错的地方。如果前端把整个 `state` 上传覆盖，两个管理员同时操作就会互相覆盖——A 改了题库，B 改了试卷，B 后提交，A 的改动消失。

正确做法是**按 id 做集合级合并**：

```
前端提交：{ questions: [改动的题...], exams: [改动的卷...] }
          ↓
服务端：对每个集合，按 id 找到已有记录 → 合并字段 → 没有则新增
        标记 deleted 的 → 从数组移除
        rev + 1
```

```js
function mergeById(cur, incoming, key='id'){
  for (const item of incoming || []) {
    const i = cur.findIndex(x => x[key] === item[key]);
    if (i >= 0) cur[i] = { ...cur[i], ...item };
    else if (!item.__deleted) cur.push(item);
  }
  return cur.filter(x => !x.__deleted);
}
```

**代价**：删除必须用标记（`__deleted: true`），不能用「不在列表里就算删」——那会把别人刚加的数据删掉。

### 2.3 原子写：`.tmp` + `rename`

```js
function saveState(){
  const json = JSON.stringify({ rev: ++state.rev, state: state.state });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, DATA_FILE);   // rename 在同一分区是原子操作
}
```

`rename` 在 NTFS / ext4 上都是原子的：要么是旧文件，要么是新文件，不会出现半个文件。

**注意**：`.tmp` 必须和目标文件在**同一个分区**，否则 `rename` 会退化成复制。

## 3. 服务层的组织方式

单文件 `server.js`，不用路由框架，用最朴素的分支：

```js
const url = new URL(req.url, 'http://' + req.headers.host);
const pathname = url.pathname;

if (pathname === '/api/state')     return handleState(req, res);
if (pathname === '/api/save')      return handleSave(req, res);
if (pathname.startsWith('/api/local/')) return handleLocal(req, res, pathname);
// 兜底：静态文件
serveStatic(req, res, pathname);
```

**好处**：没有中间件洋葱模型，读代码时不需要在十几个文件之间跳。800 行以内完全可控。

**坏处**：接口超过 30 个就会难维护。到那个规模，按业务拆成 `routes/xxx.js` 用 `require` 拼起来，但**依然不用 Express**。

### 静态托管的两个要点

1. **MIME 表要手写**（Node 不内置）：`.html / .js / .css / .png / .json / .svg / .ico / .woff2`
2. **`index.html` 特殊处理**：`/` 映射到主 HTML 文件名；文件名带中文时 URL 要 `decodeURIComponent`

### 端口顺延

```js
function pickPort(prefer, cb){
  const srv = net.createServer();
  srv.once('error', () => pickPort(prefer + 1, cb));   // 被占就 +1
  srv.once('listening', () => { srv.close(() => cb(prefer)); });
  srv.listen(prefer, '0.0.0.0');
}
```

固定 3000 是给客户的「预期」——同事访问地址永远是 3000。只有被占时才顺延，并在启动日志和界面上明确显示实际端口。

## 4. 前端架构

### 4.1 单文件里的四个层次

```
<style>   —— 全部样式（含追加的视觉主题段）
<body>    —— 三个顶层视图：首页(开场) / 登录 / 后台
<script>  —— ① 状态与工具函数 ② 渲染函数 ③ 事件绑定 ④ 轮询
```

### 4.2 视图切换

用 `hidden` class 控制显隐，不用路由框架：

```js
function show(view){   // 'home' | 'login' | 'app'
  for (const v of ['home','login','app']) {
    document.getElementById(v).classList.toggle('hidden', v !== view);
  }
}
```

刷新后靠 `localStorage` 恢复登录态：

```js
const LS = { user:'ywx_user', settings:'ywx_settings', draft:'ywx_draft' };
```

### 4.3 模块开关（版本分级的关键）

12 个模块各有一个 `key`，存成对象：

```js
const MODULE_DEF = [
  { k:'dash', n:'概览',    d:'登录后的首页看板',           lv:1 },
  { k:'exam', n:'组卷',    d:'把题目组装成考卷',           lv:1 },
  { k:'score', n:'成绩',   d:'打分复核、成绩看板',         lv:1 },
  { k:'users', n:'账号',   d:'客服账号与权限',             lv:1 },
  { k:'gen',  n:'出题',    d:'贴资料 AI 出题、期次管理',    lv:2 },
];
```

- `lv` 是版本层级（1 基础 / 2 进阶 / 3 AI），预设按钮按 `lv` 批量勾选
- `need` 声明依赖：关掉父模块，子模块自动置灰
- 关掉的模块在**侧栏、子 tab、员工端 tab 三处同时隐藏**，但数据一条不删

**卖点**：同一份安装包，按客户买的版本点一下预设，不用重新打包。

### 4.4 轮询

```js
setInterval(async () => {
  if (document.hidden) return;              // 后台标签页不轮询
  const r = await fetch('/api/state?rev=' + lastRev);
  if (r.status === 304) return;             // 没变就不处理
  applyState(await r.json());
}, 2500);
```

三个细节决定体验：

1. **`document.hidden` 跳过** —— 否则客户开 10 个标签页，服务端压力翻 10 倍
2. **带 `rev` 条件请求** —— 服务端可以返回 304，省 99% 流量
3. **2.5 秒是实测最优** —— 1 秒太频繁（30 人 = 30 QPS），5 秒公告不够及时

## 5. 权限模型

只有两种角色，用最朴素的方式：

| 角色 | 存储 | 能做什么 |
|---|---|---|
| 管理员 `admin` | `state.ywx_users` 里 `role:'admin'` | 全部（出题/组卷/评分/账号/设置） |
| 客服 `cs` | 同表 `role:'cs'` | 答题、查自己的成绩、看培训资料 |

**密码明文存**——这是有意的取舍：客户是内网 30 人规模，明文让管理员能直接帮员工找回密码。如果客户提出合规要求，改成 `crypto.scryptSync` 加盐，代价是「管理员不能再帮人查密码」。

**前端不能做权限**：所有写接口在服务端校验 `role`。前端隐藏按钮只是 UI 便利。

## 6. AI 层（双轨）

```
                ┌── 在线：OpenAI 兼容协议 → api.deepseek.com / api.openai.com
engine 选择 ────┼── 本地：llama-server.exe（OpenAI 兼容） → 127.0.0.1:8090
                └── 仅规则：不调模型，从资料里抽句子拼题
```

关键设计：**本地 llama-server 也提供 OpenAI 兼容接口**，所以上层代码完全不用区分：

```js
const base = engine === 'local' ? 'http://127.0.0.1:8090/v1' : cfg.apiBase + '/v1';
const res = await fetch(base + '/chat/completions', { ... });
```

一份请求代码，三种引擎。降级链：`本地 → 在线 → 仅规则`，任一层失败自动往下走。

## 7. 交付层（Electron 零侵入）

`main.js` 只做三件事，前端一行不改：

1. 把 `resources/` 拷到 `userData`（首次）
2. `require` 起 `server.js`
3. 开 `BrowserWindow` 指向 `http://127.0.0.1:<port>`

**产品改名时不要改 `userData` 目录名**——老客户的成绩、模型都在里面。

详见 `electron-packaging.md`。
