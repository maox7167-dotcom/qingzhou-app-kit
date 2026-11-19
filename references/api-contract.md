# API 契约

服务端共 16 个接口，全部返回 JSON。无鉴权（内网信任模型），所有写操作在服务端做角色校验。

## 通用约定

- 请求体：`application/json`，UTF-8
- 成功：`200` + 业务字段；业务失败：`200` + `{ok:false, error:'中文原因'}`（前端统一弹 toast）
- 参数错误：`400` + `{error:'missing key'}`
- 响应头统一 `Cache-Control: no-store`（除静态资源）

```js
function sendJSON(res, obj, code = 200){
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}
```

---

## 一、数据读写（2 个）

### `GET /api/state`

拉全量数据。前端 2.5 秒轮询一次。

**响应**
```json
{
  "rev": 159,
  "data": {
    "ywx_users": [], "ywx_questions": [], "ywx_scopes": [],
    "ywx_exams": [], "ywx_materials": [], "ywx_attempts": [],
    "ywx_settings": {}
  }
}
```

> 优化空间：目前每次返回全量。数据超过 2MB 时建议加 `?rev=159`，服务端 rev 未变直接返回 `304`。

### `POST /api/save`

写入一个集合。**按 key 整体替换**，不做 id 级合并。

**请求**
```json
{ "key": "ywx_questions", "value": [ { "id": "q1", "...": "..." } ] }
```

**响应** `{ "rev": 160 }`

**注意**：整体替换意味着「两个管理员同时改题库，后提交的覆盖先提交的」。30 人规模下这个风险可接受（题目编辑很少并发）。**如果要升级成 id 级合并**，改 `mergeKey()`：

```js
function mergeKey(key, value){
  const cur = state[key];
  if (!Array.isArray(cur) || !Array.isArray(value)) { state[key] = value; return; }
  for (const item of value) {
    const i = cur.findIndex(x => x.id && x.id === item.id);
    if (i >= 0) cur[i] = { ...cur[i], ...item };
    else if (!item.__deleted) cur.push(item);
  }
  state[key] = cur.filter(x => !x.__deleted);
}
```

---

## 二、局域网信息（1 个）

### `GET /api/netinfo`

界面顶部「同事访问地址」。

**响应**
```json
{ "port": 3000, "ips": ["192.168.17.45"], "hostname": "DESKTOP-XXXX" }
```

`ips` 取所有非回环 IPv4，前端取第一个。多网卡机器会给多个，让用户自己选。

---

## 三、本地模型（9 个）

统一的响应约定：`{ ok: true, ... }` 或 `{ ok: false, error: '中文原因' }`。**所有错误必须是人话**，前端直接 toast 展示。

### `GET /api/local/scan?dir=<路径>`

硬件自检 + 模型发现 + 方案生成。**这是整套 AI 功能的核心接口**，一次调用返回前端渲染方案卡所需的全部数据。

**响应结构**
```json
{
  "ok": true,
  "dir": "D:\\轻舟HR模型",
  "exeBuiltin": true,
  "exePath": "C:\\Users\\x\\AppData\\Roaming\\QingzhouHR\\llama\\llama-server.exe",
  "sys": {
    "cpu": "Intel i5-10400F", "cores": 12,
    "memGB": 15.9, "memFreeGB": 9.2,
    "gpu": "NVIDIA GTX 1060", "vramGB": 3,
    "diskFreeGB": 120
  },
  "models": [ { "key": "local-06", "file": "Qwen3-0.6B-Q4_K_M.gguf", "size": 396361728 } ],
  "plans": {
    "list": [
      {
        "key": "local-17",
        "title": "本地 1.7B",
        "fit": "ok",
        "ready": true,
        "modelPath": "D:\\轻舟HR模型\\Qwen3-1.7B-Q4_K_M.gguf",
        "speed": "约 1 分钟 / 10 题",
        "mem": "需 3GB 内存",
        "tip": "有独显时最均衡的档位",
        "best": false
      }
    ],
    "best": "local-17"
  }
}
```

`fit` 取值：`good` / `ok` / `bad`（对应界面「推荐 / 适合 / 不建议」）。
`best` **必须挂在对象上，不能挂在数组上**——数组属性不会被 `JSON.stringify` 序列化。

### `POST /api/local/start`

启动推理服务。

**请求** `{ "modelPath": "D:\\...\\x.gguf", "port": 8090, "ctx": 4096, "gpuLayers": 99 }`

**响应** `{ "ok": true, "pid": 12345, "port": 8090, "model": "x.gguf" }`

内部用 `child_process.spawn` 起 `llama-server.exe`，参数：

```
-m <模型路径> --port <端口> --host 127.0.0.1
-c <上下文长度> -ngl <GPU 层数>   # -ngl 99 = 全部卸载到显卡
--no-webui   # 关掉自带页面，减少暴露面
```

启动后要**轮询 `/health` 直到 200** 才算成功，不能只看进程起来了（进程活着但模型加载失败很常见）。

### `POST /api/local/stop`

**响应** `{ "ok": true, "stopped": true }`

`stop` 后必须把 `LOCAL_PROC` 置 null，并在主进程 `exit` / `SIGINT` 时兜底 kill，否则客户关掉程序后 `llama-server` 还在吃内存。

### `GET /api/local/status?port=8090`

**响应**
```json
{ "ok": true, "alive": true, "port": 8090, "models": ["x.gguf"],
  "proc": true, "pid": 12345, "info": { "startedAt": 1730000000 } }
```

`alive` 通过给 `/v1/models` 发 GET 判断，比查进程可靠。

### `POST /api/local/chat`

**代理到本地模型的 OpenAI 兼容接口**（避免前端跨域）。

**请求**
```json
{ "port": 8090, "payload": { "messages": [{"role":"user","content":"..."}], "temperature": 0.7 } }
```

**响应** `{ "ok": true, "data": { "choices": [ ... ] } }`

超时设 **600 秒**——纯 CPU 跑 4B 出 10 道题可能要 5 分钟，设短了必失败。

### `POST /api/local/opendir`

打开（必要时创建）模型目录。只调 `explorer.exe`，**不执行目录里任何文件**。

**请求** `{ "dir": "D:\\轻舟HR模型" }` → **响应** `{ "ok": true, "dir": "...", "created": true }`

自动化测试时设环境变量 `YWX_NO_OPEN=1`，只建目录不弹窗。

### `GET /api/local/catalog`

可下载的模型白名单。

**响应**
```json
{ "ok": true, "dir": "D:\\...",
  "items": [ { "key":"local-06", "label":"本地 0.6B", "file":"...gguf", "size":396361728, "mb":378 } ] }
```

**只允许白名单内的 key**，防止被当成任意文件下载器。

### `POST /api/local/download`

启动下载。**立刻返回，实际下载在后台跑**——否则 HTTP 请求要挂 5 分钟。

**请求** `{ "key": "local-06", "dir": "D:\\轻舟HR模型" }`

**响应** `{ "ok": true, "state": "starting", "total": 396361728 }`

同一时刻只允许一个下载任务。

### `GET /api/local/download/status`

**响应**
```json
{ "state": "running", "key": "local-06", "got": 104857600, "total": 396361728,
  "percent": 26, "speed": "24.7 MB/s", "error": "" }
```

`state`：`idle` / `running` / `done` / `error` / `canceled`

### `POST /api/local/download/cancel`

**响应** `{ "ok": true, "state": "canceled" }`

取消只停止写入，**保留已下载的分片**，下次继续时用 `Range` 续传。

---

## 四、外部集成（3 个）

### `GET /api/wish-hook`

告诉前端「服务端是否已内置上报地址」。**只回布尔，绝不下发真实地址**。

**响应** `{ "builtin": true, "type": "wecom" }`

### `POST /api/wish-report`

转发客户提交的诉求到企业微信 / 飞书群机器人（绕开浏览器跨域）。

**请求** `{ "content": "...", "name": "...", "contact": "", "__test": false }`

**响应** `{ "ok": true }` / `{ "ok": false, "skipped": "未配置上报地址" }`

两个安全设计：
1. **内置地址优先**，客户本机的设置无法覆盖（防止被改到别处）
2. **测试消息限频**：同一台机器 1 分钟只能发一条 `__test`

### `POST /api/skills/fetch`

抓取 GitHub 上的 `SKILL.md`，前端解析后入库。

**请求** `{ "url": "https://github.com/owner/repo/blob/main/SKILL.md" }`

**响应** `{ "ok": true, "content": "...", "via": "https://raw.githubusercontent.com/..." }`

内部把 `github.com/.../blob/...` 自动转成 `raw.githubusercontent.com`，失败时依次尝试镜像（`gh-proxy.com` 前缀等）。返回内容上限 512KB。

---

## 前端调用约定

```js
// 统一封装，避免每处都写 fetch 细节
async function api(path, body){
  const opt = body
    ? { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }
    : {};
  const r = await fetch(path, opt);
  const j = await r.json();
  if (j && j.ok === false && j.error) toast(j.error);
  return j;
}
```

三个必须遵守的规则：

1. **所有 `ok:false` 的 `error` 必须是人话**，不能是 `ECONNREFUSED` 这种
2. **长任务一律「立刻返回 + 轮询状态」**，不要用一个请求等到底
3. **敏感信息只下发布尔值**，真实地址 / 密钥永远留在服务端
