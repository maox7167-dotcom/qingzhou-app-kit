# 轻舟 App Kit

> 一套「零依赖单文件后台系统」的完整开发方法 + 可直接运行的工程模板。
> 一个人两周交付一个客户系统，打包成一个 exe，客户电脑上不用装任何东西。

---

## 这个 Kit 解决什么问题

给中小企业做内部系统，最大的成本不在写业务，而在这三件事：

1. **装环境** —— 客户没有 IT，装不了 MySQL、Docker、Node
2. **交付** —— 客户要的是「双击就能用」，不是「你先 npm install」
3. **售后** —— 客户换个电脑就让你去「迁移数据」

这套 Kit 的答案：**数据存一个 JSON 文件，前端一个 HTML 文件，后端零依赖，交付一个 exe**。

- 备份 = 复制一个文件
- 迁移 = 拷贝一个文件
- 客户自己能恢复

代价也说清楚：**数据量 10 万条以内、并发 30 人以内**。超过就该换正经数据库，`SKILL.md` 里有一张判断表。

---

## 里面有什么

```
qingzhou-app-kit/
├─ SKILL.md                     五阶段流水线（AI 读这个干活）
├─ README.md                    这份说明（人读）
├─ LICENSE.md                   商业使用许可
├─ CHANGELOG.md                 版本更新记录
│
├─ template-app/                可直接运行的完整工程（前端 + 后端 + 演示数据）
│  ├─ app.html                  前端主程序（5600 行，含 12 个模块）
│  ├─ server.js                 后端（887 行，零依赖）
│  ├─ data.json                 演示数据（75 题 / 31 账号）
│  ├─ manifest.json / sw.js / icon-*.png   手机可安装
│  └─ start.bat                 双击即跑
│
├─ template-electron/           桌面封装工程（main.js + 打包配置 + 图标）
│  ├─ main.js / preload.js      主进程
│  ├─ package.json              electron-builder 配置
│  └─ icon.ico / installer.ico  应用图标与安装包图标
│
├─ references/                  六份实战文档
│  ├─ architecture.md           架构取舍、数据层设计、并发策略
│  ├─ api-contract.md           16 个接口的请求响应契约
│  ├─ local-llm.md              本地大模型：硬件自检、模型选型、许可
│  ├─ electron-packaging.md     打包命令、版本同步、启动失败排查
│  ├─ anti-patterns.md          23 条踩过的坑（最值钱的一份）
│  └─ migration.md              把示例业务换成客户业务的删改清单
│
└─ scripts/                     四个自动化脚本
   ├─ new_app.py                一条命令生成新项目
   ├─ smoke.js                  冒烟测试 + 横向溢出检测
   ├─ sanitize_check.py         交付前脱敏自查
   └─ fetch_llama.py            下载裁剪 llama.cpp 二进制
```

---

## 安装

把整个 `qingzhou-app-kit` 目录放到：

```
Windows： C:\Users\<你的用户名>\.workbuddy\skills\
macOS/Linux： ~/.workbuddy/skills/
```

重启 WorkBuddy，说一句「用轻舟 App Kit 帮我做一个巡检系统」，它就会自动加载。

### 依赖

| 组件 | 用途 | 是否必须 |
|---|---|---|
| Node.js 18+ | 跑后端、打包 | 必须 |
| Python 3.8+ | 跑生成/自查脚本 | 必须 |
| Edge 或 Chrome | 冒烟测试（Windows 自带 Edge） | 建议 |
| `playwright-core` | 冒烟测试驱动 | 建议（`npm i playwright-core`） |

模板本身**不需要任何 npm 依赖**，`node server.js` 直接跑。

---

## 三个典型场景

### 场景一：给客户做一个新系统（最快路径）

```bash
# 1. 生成项目（30 秒）
python scripts/new_app.py ../客户A巡检系统 \
       --brand "某某云" --sub "设备巡检系统" --name kehuA --port 3000

# 2. 起服务看效果（electron/resources 已自动同步好，可直接打包）
cd ../客户A巡检系统/app && node server.js
# 浏览器打开 http://localhost:3000，账号 admin01 / admin888

# 3. 改业务（按 references/migration.md，1~3 天）
#    改一个模块跑一次冒烟，别一次全改

# 4. 冒烟
node scripts/smoke.js http://localhost:3000

# 5. 打包
cd ../客户A巡检系统/electron
npm install
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
node node_modules/electron-builder/cli.js --win

# 6. 交付前脱敏
python scripts/sanitize_check.py ../客户A巡检系统
```

### 场景二：只换视觉不改业务

```bash
# 换主色（会自动生成整套色阶，含首页深色背景与粒子色）
python scripts/new_app.py ../新版 --brand "新品牌" --name newbrand --color 2563EB
```

换的品牌名、副标题、端口、主色会同步到：页面标题、登录页、侧栏、页脚、导出文件名、安装包名、**exe 窗口标题**、**数据目录名**。

### 场景三：给已有系统接本地 AI

读 `references/local-llm.md`，按里面的五档方案规则 + `scripts/fetch_llama.py` 落地。

关键结论先说：**主推在线 API，本地模型当「离线兜底」卖**。0.6B 的质量撑不起演示，1.7B 才勉强能用。

---

## 这份 Kit 里最值钱的部分

按买家用得上的频率排：

1. **`anti-patterns.md` 那 23 条坑** —— 每一条都能省半天。中文路径导致文件写错目录、可视化编辑器污染 HTML、打包忘同步资源、`ELECTRON_RUN_AS_NODE` 让 exe 秒退、数组属性不被序列化……这些不是看文档能学到的，是踩出来的
2. **`migration.md` 的删改清单** —— 教你 2 天把考试系统改成巡检系统，而不是从零写
3. **可运行的完整模板** —— 不是骨架片段，是 5600 行能跑的成品，登录、权限、12 个模块、AI 引擎、模块开关全都在
4. **`smoke.js`** —— 冒烟 + 横向溢出检测。手机端溢出是这类系统最常见的交付事故，这个脚本能自动抓出来
5. **本地大模型链路** —— 硬件自检 → 方案分级 → 一键下载 → 内置推理，客户点两下就能用。这是差异化卖点

---

## 常见问题

**Q：模板是考试系统，我要做别的业务，工作量多大？**
A：看 `migration.md` 的三种强度。只换文案半天，换实体 1–2 天，重做页面 3–5 天。账号、通知公告、技能库这三块和业务无关，直接复用。

**Q：20 个人同时用会不会卡？**
A：不会。实测 30 个客户端 2.5 秒轮询，服务端 CPU < 3%。数据到 20MB 才需要换 SQLite。

**Q：客户要 exe，但我不会 Electron？**
A：`electron-packaging.md` 里从零到打包产物全写完了，`main.js` 170 行，照着改品牌名就行。

**Q：本地模型选哪个？**
A：显存 ≥ 6GB 用 4B；只有内存用 1.7B；要「先跑起来看看」用 0.6B。**别用 Qwen2.5-3B，许可证禁止商用。**

**Q：交付前最容易出什么事？**
A：把自己的 API Key 打进安装包。`data.json` 里存了设置页的 `apiKey`，打包时一起发给客户，客户直接用你的额度。**每次交付前跑 `sanitize_check.py`。**

**Q：能改完再卖给别人吗？**
A：用 Kit 做出来的成品随便卖，`LICENSE.md` 里写清了。转售 Kit 本身不行。

---

## 版本

**v1.0.2 · 2026-11-14**

模板基于一个真实交付并运行中的企业培训考试系统（3.4.1），不是玩具 demo。每一版的改动都记在 `CHANGELOG.md`。

---

## 更新与支持

| 事项 | 方式 |
|---|---|
| 获取新版（12 个月内 v1.x） | 加微信 `mao86618` 凭订单截图入群，新版地址在**群公告置顶**（包内不放下载链接，避免外流） |
| 版本咨询 | 邮件 `2357950889@qq.com`，3 个工作日内回复 |
| 文档答疑 | 同上邮箱，请附「现象 + 截图 + 报错原文」 |
| 不包含 | 代做项目、远程调试客户环境、定制开发 |

微信 `mao86618` ／ 邮箱 `2357950889@qq.com` ／ 售价 **8.8 元**（单套授权，含 12 个月内 v1.x 更新）
