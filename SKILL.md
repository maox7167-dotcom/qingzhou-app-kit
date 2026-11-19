---
name: qingzhou-app-kit
version: 1.0.2
display_name: 轻舟 App Kit · 零依赖后台系统
display_name_en: Qingzhou App Kit
description: 用于搭建或改造「零依赖单文件后台系统」——单文件 HTML 前端 + 纯 Node 内置模块后端 + 单 JSON 文件存储 + Electron 桌面封装 + 可选本地大模型（llama.cpp + Qwen3 GGUF）。当用户要为企业做内部管理系统（培训考试、设备巡检、工单派单、客户跟进、进销存、门店检查）、要把 Web 系统打成 Windows exe 交付客户、要在离线内网接入可商用的本地 AI、或要维护一套已用此架构运行的系统时使用。内含可直接运行的全功能模板、五阶段流水线、16 个 API 契约、Windows 打包命令、本地大模型链路，以及 23 条只有踩过才知道的坑。
description_zh: 一条命令生成可交付客户的企业内部管理系统：单文件 HTML 前端 + 零依赖 Node 后端 + 单 JSON 存储，可打成 Windows exe，可选离线本地大模型。覆盖培训考试、设备巡检、工单派单、客户跟进、进销存等场景，含五阶段流水线、16 个接口契约、打包命令与 23 条实战踩坑清单。
description_en: Generate a client-deliverable internal management system with one command — single-file HTML frontend, zero-dependency Node backend, single-JSON storage, packaged as a Windows exe, with optional offline local LLM. Covers training exams, equipment inspection, work orders, CRM and inventory. Includes a five-stage pipeline, 16 API contracts, Windows packaging steps and 23 battle-tested pitfalls.
agent_created: true
---

# 轻舟 App Kit · 零依赖单文件后台系统

一套「一个人两周就能交付给客户」的架构：**没有数据库、没有前端框架、没有构建工具、没有 npm 依赖**。双击就能跑，打包就是一个 exe，客户电脑上不需要装任何东西。

代价是：业务增长到几千条记录、几十人并发时扛不住。所以先用「何时别用」这一节判断清楚。

## 何时用这套栈

| 场景特征 | 适合 |
|---|---|
| 客户是中小企业，5–50 人局域网内使用 | ✅ |
| 客户 IT 能力弱，装不了 MySQL / Docker | ✅ |
| 交付物要能双击运行，最好是单个 exe | ✅ |
| 内网涉密不能出网，但想要 AI 能力 | ✅ |
| 你要按客户买的功能模块做版本分级 | ✅ |
| 数据量 10 万条以内、并发 30 人以内 | ✅ |
| 需要多租户 / 分库分表 / 高并发写入 | ❌ 用 PostgreSQL |
| 需要小程序 / App 原生体验 | ❌ 前端换框架 |
| 多人实时协作（秒级同步光标那种） | ❌ 加 WebSocket + CRDT |
| 客户要求等保三级 / 审计日志合规 | ❌ 至少得上正经数据库 |

判断标准一句话：**数据能装进一个 JSON 文件、一天改不了几千次，就用这套。**

## 架构总览

```
┌─ 表现层  单文件 HTML + 原生 JS（无框架、无 CDN、无构建）
├─ 通信层  HTTP + JSON 轮询（不用 WebSocket：够用，且不会断线重连写崩）
├─ 服务层  Node 内置模块（http/fs/path/os/child_process/https）
├─ 数据层  单 JSON + rev 递增 + .tmp 原子写 + 按 id 合并
├─ AI 层   双轨：在线 API（OpenAI 兼容） / 本地 llama.cpp + Qwen3 GGUF
└─ 交付层  Electron 壳（零侵入：前端一行不改）+ electron-builder
```

## 五阶段流水线

### 阶段 0 · 选型判断（5 分钟，别省）

1. 问清数据量级与并发（「多少人同时用」「一天产生多少条记录」）
2. 用上面的表判断；不适合就直说，别硬上
3. 确认交付形态：网页版（客户有服务器）/ exe（客户电脑当服务器）
4. 确认是否需要 AI、是否必须离线

### 阶段 1 · 生成项目骨架

```bash
python scripts/new_app.py <项目目录> --brand "产品名" --name yunxunjian --company "客户公司名" --port 3000
```

`--name` 是英文短名，建议务必带上：它决定 `%APPDATA%` 数据目录、`appId` 和 exe 名。中文品牌不指定时脚本会退化成用目录名，容易两个项目串库。

生成物：可运行的后台系统（登录 + 侧栏 + 数据看板 + 列表 + 表单 + 弹窗 + 设置页），以及**已同步好的 `electron/resources`**（打包必需，缺了 exe 会白屏）。品牌名、主色、端口都可配。

生成后立刻验证：

```bash
cd <项目目录>/app && node server.js     # 浏览器开 http://localhost:3000
```

### 阶段 2 · 把示例业务换成客户的业务

模板示例业务是「企业客服培训考试」。换成别的业务按 `references/migration.md` 的删改清单走，核心三步：

1. **改数据模型** —— 在 `server.js` 的 `defaultState()` 里定义实体
2. **加后端接口** —— 通用 `/api/state` + `/api/save` 通常够用，特殊业务再加专用路由
3. **改前端页面** —— 每个模块一个 `<section>`，按现有模式复制改写

**不要一次性全改完。** 一个实体一个实体地换，每换一个就跑 `scripts/smoke.js`，能省掉 80% 的排查时间。

### 阶段 3 · 接入本地大模型（可选）

只在客户明确要求「不能出网」时做。按 `references/local-llm.md`：

1. 硬件自检 → 按 CPU / 内存 / 显存取 5 档方案
2. 模型按需下载（0.6B 378MB 够跑通 / 1.7B 1056MB 质量可用 / 4B 2382MB 需独显）
3. llama.cpp 二进制随安装包分发，首次启动释放到用户目录
4. 统一成 OpenAI 兼容协议，和在线 API 走同一套代码

**先给客户看在线 API 的效果，再谈本地模型。** 0.6B 的质量会让第一次见的人失望。

### 阶段 4 · 打包成 exe

```bash
cd electron && npm install && npx electron-builder --win
```

详细步骤、镜像配置、四种打包失败原因见 `references/electron-packaging.md`。

### 阶段 5 · 验收（必做）

```bash
node scripts/smoke.js http://localhost:3000        # 冒烟：登录 + 遍历模块 + 横向溢出检测
python scripts/sanitize_check.py <项目目录>          # 脱敏：确认没有自己的密钥/姓名/手机号
```

两条都过才允许交付。**冒烟脚本必须报「横向溢出 0px」**——手机端溢出是这类单文件系统最常见的交付事故。

## 三条不能破的铁律

1. **数据只有一个 JSON 文件，写入必须原子** —— 先写 `.tmp` 再 `rename`，同时 `rev` 递增。少写一步，客户断电就得到半个文件。
2. **前端不引入任何外链** —— 客户内网连不上 Google Fonts / CDN，一个外链就能让首屏白屏 30 秒。图标用内联 SVG，字体用系统字体。
3. **改视觉只往末尾追加样式段** —— 老规则一条不删。这样随时能回滚，也不会因为覆盖顺序踩到 `!important` 的坑。

## 参考资料索引

| 文件 | 什么时候读 |
|---|---|
| `references/architecture.md` | 想搞清楚数据层、rev 合并、原子写、并发策略为什么这样设计 |
| `references/api-contract.md` | 加接口 / 改接口 / 写前端请求时对照 |
| `references/local-llm.md` | 接本地大模型：硬件自检规则、模型选型、llama.cpp 集成、许可证 |
| `references/electron-packaging.md` | 打包、换图标、配镜像、exe 启动失败排查 |
| `references/anti-patterns.md` | **每次动手前扫一遍**，23 条踩过的坑，全是会浪费半天的 |
| `references/migration.md` | 把示例的考试业务换成客户业务时的删改清单 |

## 脚本

| 脚本 | 用途 |
|---|---|
| `scripts/new_app.py` | 从模板生成新项目（换品牌名/主色/端口/模块） |
| `scripts/smoke.js` | Playwright 冒烟：登录、遍历模块、抓 JS 报错、检测横向溢出 |
| `scripts/sanitize_check.py` | 交付前脱敏自查：密钥、webhook、真实姓名、手机号、本机路径 |
| `scripts/fetch_llama.py` | 下载并裁剪 llama.cpp Windows 二进制（只留推理必需文件） |

## 交付前自检清单

- [ ] `node server.js` 能起，浏览器能登录
- [ ] `smoke.js` 全绿，横向溢出 0px
- [ ] `sanitize_check.py` 无告警
- [ ] `data.json` 是干净库（无真实客户数据、无自己的 API Key）
- [ ] 手机宽度 390px 下每个模块都能看
- [ ] exe 双击能起，窗口标题正确
- [ ] 使用说明里写清默认账号、数据位置、备份方式
- [ ] 第三方许可证随包分发（llama.cpp MIT / Qwen3 Apache-2.0 / LLVM）
