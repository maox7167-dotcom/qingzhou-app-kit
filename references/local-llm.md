# 本地大模型链路

给「内网不能出网」的客户提供 AI 能力。整套方案的目标：**客户不懂技术，点两下就能用**。

## 1. 为什么不直接让客户装 Ollama

| 方案 | 客户要做的事 | 失败率 |
|---|---|---|
| Ollama / LM Studio | 下载安装包 → 安装 → 命令行拉模型 → 配端口 → 改我们的设置 | 高（一半客户卡在命令行） |
| 本方案 | 双击 exe → 点「检测本机配置」→ 点「下载」 | 低 |

差别不在技术，在**交付摩擦**。客户是厂长、行政、客服主管，不是开发者。

## 2. 五档方案规则

按内存 + 显存 + 磁盘剩余空间自动打标：

| key | 名称 | 模型 | 内存门槛 | 显存门槛 | 磁盘 | 实测出 10 题 |
|---|---|---|---|---|---|---|
| `online` | 在线 API | DeepSeek / OpenAI | 无 | 无 | 无 | 7 秒 |
| `local-4b` | 本地 4B | Qwen3-4B Q4_K_M（2.3GB） | ≥ 15GB | ≥ 6GB（有独显更佳） | ≥ 6GB | 40–90 秒（独显） |
| `local-17` | 本地 1.7B | Qwen3-1.7B Q4_K_M（1.0GB） | ≥ 7.5GB | 可选 | ≥ 3GB | 约 60 秒 |
| `local-06` | 本地 0.6B | Qwen3-0.6B Q4_K_M（378MB） | ≥ 3.5GB | 无 | ≥ 2GB | 约 30 秒 |
| `rule` | 仅规则 | 不调模型，从资料抽句 | 无 | 无 | 无 | 0.1 秒 |

**阈值必须向下取整。** 客户说 16G，系统读到 15.9G。写 `>= 16` 会把这台机器判成不够 4B，客户会觉得软件「不识货」。

```js
const memGB = os.totalmem() / 1073741824;      // 15.9
const fit4b  = memGB >= 15 ? 'good' : memGB >= 11.5 ? 'ok' : 'bad';
const fit17  = memGB >= 7.5 ? 'good' : memGB >= 5 ? 'ok' : 'bad';
const fit06  = memGB >= 3.5 ? 'good' : 'ok';
```

`fit` 三档对应界面：`good` = 推荐 ✅ / `ok` = 适合 ⚠ / `bad` = 不建议 ✖。

`best`（打星的那个）的选取顺序：先看 `online` 是否已配 Key → 再看显存够不够 4B → 否则 1.7B → 最后 0.6B。

## 3. 硬件探测（不装任何依赖）

### CPU
```js
// Windows：wmic 已在新版被弃用，用 PowerShell 更稳
const cpu = require('child_process')
  .execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor).Name"',
            { encoding:'utf8', timeout: 4000 }).trim();
```
兜底：`os.cpus()[0].model`。

### 内存
```js
const memGB = +(os.totalmem() / 1073741824).toFixed(1);
const memFreeGB = +(os.freemem() / 1073741824).toFixed(1);   // 空闲值波动大，只作参考
```

### 显卡与显存
```js
// nvidia-smi 最准，没有就用 PowerShell 的 WMI
const gpu = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits',
                     { encoding:'utf8', timeout: 4000 });
```
没有 N 卡时用 `Get-CimInstance Win32_VideoController` 拿名字（拿不到显存，只能判断「有独显」）。

**注意**：`Win32_VideoController.AdapterRAM` 是 32 位字段，超过 4GB 会溢出。别用它算显存。

### 磁盘
```js
// Node 18+ 有 statfs
const s = fs.statfsSync(modelDir);
const freeGB = +(s.bavail * s.bsize / 1073741824).toFixed(1);
```

## 4. 模型选型

### 只用 Qwen3 系列，原因有三

1. **全系 Apache 2.0**，可商用、可分发、不用给授权费
2. 中文能力在同尺寸里最好
3. ModelScope 有官方 GGUF 仓库，国内直连速度快

### ⚠️ 禁用 Qwen2.5-3B

Qwen2.5 系列的 3B 模型用的是 **Qwen Research License**，明确禁止商用。客户拿去卖服务会踩雷。要 3B 量级就用 Qwen3-4B 或 Qwen3-1.7B。

### 量化只用 Q4_K_M

| 量化 | 0.6B | 1.7B | 4B | 评价 |
|---|---|---|---|---|
| Q8_0 | 640MB | 1.8GB | 4.2GB | 质量好但太大，没必要 |
| **Q4_K_M** | **378MB** | **1056MB** | **2382MB** | **质量/体积最优，统一用它** |
| Q3_K_M | 300MB | 840MB | 1.9GB | 中文开始出现明显错字 |

## 5. 下载源

### ModelScope 直链（推荐）

格式固定，免登录、免注册、支持 Range：

```
https://modelscope.cn/models/{owner}/{repo}/resolve/master/{filename}
```

三个已实测可用的：

```js
const MODEL_CATALOG = {
  'local-06': {
    label: '本地 0.6B',
    file: 'Qwen3-0.6B-Q4_K_M.gguf',
    size: 396361728,       // 精确字节数，用于完整性校验
    url: 'https://modelscope.cn/models/unsloth/Qwen3-0.6B-GGUF/resolve/master/Qwen3-0.6B-Q4_K_M.gguf'
  },
  'local-17': {
    label: '本地 1.7B',
    file: 'Qwen3-1.7B-Q4_K_M.gguf',
    size: 1107382272,
    url: 'https://modelscope.cn/models/unsloth/Qwen3-1.7B-GGUF/resolve/master/Qwen3-1.7B-Q4_K_M.gguf'
  },
  'local-4b': {
    label: '本地 4B',
    file: 'Qwen3-4B-Q4_K_M.gguf',
    size: 2497282208,
    url: 'https://modelscope.cn/models/Qwen/Qwen3-4B-GGUF/resolve/master/Qwen3-4B-Q4_K_M.gguf'
  }
};
```

实测峰值速度 **24.7 MB/s**，378MB 的 0.6B 约 16 秒下完。

### GitHub 直链要加代理

GitHub Releases 国内直连只有 40KB/s。加前缀：

```
https://gh-proxy.com/https://github.com/{owner}/{repo}/releases/download/{tag}/{file}
```

## 6. 下载器实现要点

### 断点续传

```js
const got = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
const headers = got > 0 ? { Range: `bytes=${got}-` } : {};

// 服务端返回 206 才能追加，返回 200 说明不支持 Range，必须从头
const append = res.statusCode === 206;
const ws = fs.createWriteStream(tmp, append ? { flags:'a' } : {});
```

### 完整性校验

下完比对文件大小，**不要用 MD5**（几百 MB 算一次要好几秒，且官方不一定提供）：

```js
if (fs.statSync(tmp).size !== catalog.size) throw new Error('文件大小不匹配，可能没下完');
fs.renameSync(tmp, target);
```

### 进度节流

每收到一块就推一次状态会让前端渲染卡死。**按 300ms 或 1% 节流**：

```js
if (Date.now() - lastPush > 300) { lastSpeed = ...; lastPush = Date.now(); }
```

速度用滑动窗口算，不要用「总字节 / 总耗时」（后段速度变化时数字会跳）。

### 只允许白名单

`MODEL_CATALOG` 之外的 key 一律拒绝，防止接口被当成任意文件下载器。

## 7. llama.cpp 集成

### 版本与构建

用 **Vulkan 后端**（不是 CUDA）：

- N 卡、A 卡、Intel 核显都能加速，一份二进制通吃
- CUDA 版要绑定具体 CUDA 版本，客户驱动不匹配就废
- 纯 CPU 也能跑（Vulkan 自动回退）

下载：`llama.cpp` 的 GitHub Releases → `llama-bXXXXX-bin-win-vulkan-x64.zip`

实测版本 `b12184`，解压后约 32 个文件 / 89MB。

### 必须删掉的文件

压缩包里带了一堆用不上的 exe，删掉能省 30MB：

保留：`llama-server.exe`、`ggml*.dll`、`llama*.dll`、`vulkan-1.dll`、几个许可证文件
删除：`llama-cli.exe`、`llama-bench.exe`、`llama-quantize.exe`、`llama-embedding.exe`、`*.lib`

### 启动参数

```js
spawn('llama-server.exe', [
  '-m', modelPath,
  '--port', String(port),
  '--host', '127.0.0.1',
  '-c', String(ctx),          // 4096 够用，调大更吃内存
  '-ngl', String(gpuLayers),  // 99 = 全部卸载到显卡；纯 CPU 设 0
  '--no-webui'                 // 关掉自带页面，减少暴露面
], { windowsHide: true });
```

**判断启动成功不能只看进程活着**，要轮询接口：

```js
for (let i = 0; i < 60; i++) {
  await sleep(500);
  const r = await ping(`http://127.0.0.1:${port}/v1/models`);
  if (r.ok) return true;
}
```

模型加载失败时 `llama-server` 进程是活的，只是接口永远不响应。不轮询就会给客户一个「启动成功但用不了」的状态。

### 退出要兜底

```js
process.on('exit', killLocal);
process.on('SIGINT', () => { killLocal(); process.exit(0); });
```

否则客户关掉主程序后 `llama-server` 还在后台吃 1GB 内存，任务管理器里能看到一堆残留。

## 8. 实测数据（i5-10400F / 16G / GTX 1060 3G）

| 项目 | 0.6B | 1.7B | 4B |
|---|---|---|---|
| 模型加载 | 2.4s | 3.1s | 加载失败（显存不足） |
| 出 10 道题（4选4判2问） | 10.5s | 24s | — |
| 内存占用 | 1.1GB | 2.3GB | — |
| 质量评价 | 判断题常出错，需要人工复核 | 可用，偶有跑题 | 需 6GB+ 显存 |

**结论：卖客户主推在线 API。** 本地 0.6B 当「免费送的够跑通」，1.7B 当增值项，4B 只在客户明确有独显时提。

## 9. 许可证（商用必须清）

随安装包分发这三个文件，放在 `第三方许可证/`：

| 组件 | 许可证 | 义务 |
|---|---|---|
| llama.cpp | MIT | 保留版权声明 |
| Qwen3 全系 | Apache 2.0 | 保留 NOTICE，标注修改 |
| LLVM OpenMP 运行时 | Apache 2.0 with LLVM Exceptions | 保留声明 |

**不随包分发模型本身**（客户自己下载），可以避免「分发模型」带来的额外义务。如果要把模型打进安装包，务必先确认所选模型的许可证允许再分发。

## 10. 常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| 点下载没反应 | 模型目录无写权限 | 换目录，或用「打开模型目录」看能否创建 |
| 下载卡在 99% | 大小校验失败（源文件变了） | 删掉 `.download` 临时文件重下 |
| 启动后一直转圈 | 显存不足，Vulkan 初始化失败 | 把 `-ngl` 降到 0 走纯 CPU |
| 出题返回空 | 上下文超了 | 减少一次生成题数，或把 `-c` 调到 8192 |
| 首次响应 30 秒 | 模型加载 + 首次推理 | 界面必须提示「首次较慢」，否则客户以为坏了 |
