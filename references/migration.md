# 把示例业务换成客户业务

模板的示例业务是「企业客服培训考试」。换成巡检、工单、进销存时按本文操作。

## 先认清模板的 12 个模块

| key | 名称 | 层级 | 依赖 | 换业务时的处理 |
|---|---|---|---|---|
| `dash` | 概览 | 1 | — | **保留**，改指标卡 |
| `exam` | 组卷 | 1 | — | 换成「任务/工单/单据」 |
| `score` | 成绩 | 1 | — | 换成「记录/结果/报表」 |
| `publish` | 考卷公布 | 1 | score | 换成「发布/下发」 |
| `users` | 账号 | 1 | — | **保留原样** |
| `gen` | 出题 | 2 | — | 换成「AI 生成」的核心功能 |
| `qbank` | 题库管理 | 2 | gen | 换成「基础数据维护」 |
| `material` | 培训资料 | 2 | — | 换成「文档/知识库」 |
| `writer` | AI 写作 | 3 | gen | **保留**（通用性强，改模板即可） |
| `notice` | 通知公告 | 3 | — | **保留原样** |
| `skills` | 技能库 | 3 | — | **保留原样** |
| `wish` | 许愿树 | 3 | — | 建议删（面向你自己的销售，不是客户业务） |

三个判断：

1. **层级 `lv` 决定卖给客户的版本分级**，`lv:1` 是基础版必须有的
2. **`need` 是硬依赖**，删父模块必须连子模块一起删，否则会出现「勾了子模块但父模块关了」的死状态
3. **账号 / 公告 / 技能库这三块和业务无关**，直接复用，不要重写

## 三种改造强度

| 强度 | 适用 | 工作量 | 做法 |
|---|---|---|---|
| **A · 只换文案** | 业务逻辑接近（考试→认证、巡检→检查） | 半天 | 改 `MODULE_DEF` 的 `n`/`d` + 页面标题 + 字段标签 |
| **B · 换实体** | 数据结构不同但流程相似（考试→工单） | 1–2 天 | 改数据模型 + 按 id 的增删改查 + 页面表格列 |
| **C · 重做页面** | 交互形态不同（考试→看板/Kanban） | 3–5 天 | 重写 section 的渲染函数，后端接口不动 |

**先问客户一句话就能定强度**：「你这个业务，核心是填表、还是看图？」

- 填表 → A 或 B
- 看图/拖拽 → C

## 阶段 1 · 改数据模型

在 `server.js` 里找到 `defaultState()`：

```js
function defaultState(){
  return {
    ywx_users: [],        // 账号（保留）
    ywx_questions: [],    // ← 你的核心实体
    ywx_scopes: [],       // ← 你的分类/分组
    ywx_exams: [],        // ← 你的单据/任务
    ywx_materials: [],    // ← 你的文档
    ywx_attempts: [],     // ← 你的记录
    ywx_settings: {}      // 设置（保留）
  };
}
```

**改名规则：一次只改一个 key，改完立刻全局替换。** 用 `grep -c "ywx_questions"` 确认改了 12 处以上（后端 + 前端 + CSS 选择器都可能引用）。

### 举例：改成设备巡检

```js
{
  ywx_users: [],       // 巡检员 + 管理员
  ywx_questions:  →  ywx_checkitems: [],   // 检查项（含标准、分值、图例）
  ywx_scopes:     →  ywx_areas: [],        // 区域（车间/仓库/办公区）
  ywx_exams:      →  ywx_plans: [],        // 巡检计划（周期、负责人）
  ywx_materials:  →  ywx_docs: [],         // 作业指导书
  ywx_attempts:   →  ywx_records: [],      // 巡检记录（含照片、异常项）
  ywx_settings: {}
}
```

## 阶段 2 · 改后端

### 通用接口通常不用动

`/api/state` + `/api/save` 是按 key 存取的通用接口，**改数据模型不需要改接口代码**。这是这套架构最大的省力点。

### 需要新增的专用接口（按需）

| 业务需求 | 建议接口 |
|---|---|
| 上传照片（巡检必用） | `POST /api/upload` → 存到 `USER/uploads/`，返回相对路径 |
| 导出 Excel | 前端做（`Blob` + `a[download]`），不需要后端 |
| 定时任务（每日生成巡检单） | `setInterval` 在 `server.js` 里跑，直接改 `state` 后 `persist()` |
| 扫码/编号查询 | `GET /api/lookup?code=xxx` |

### 上传接口参考实现

```js
if (url === '/api/upload' && req.method === 'POST') {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const buf = Buffer.concat(chunks);
    const name = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.jpg';
    const dir = path.join(USER, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), buf);
    return sendJSON(res, { ok: true, url: '/uploads/' + name });
  });
  return;
}
```

静态托管里要把 `/uploads/` 映射到 `USER/uploads`。

## 阶段 3 · 改前端

每个模块对应一个 `<section id="av-xxx">`，共 12 个：

```
av-dash  av-exam  av-gen  av-grade  av-material  av-publish
av-qbank  av-scope  av-score  av-setting  av-users  av-writer
```

### 改一个模块的固定四步

1. **改 section 里的静态标签**（表头、按钮文字、placeholder）
2. **改渲染函数**：`grep -n "function renderQbank"` 找到渲染入口，改字段名
3. **改提交逻辑**：找到对应的 `save('ywx_questions', ...)` 调用
4. **跑冒烟脚本**确认没崩

### 删一个模块的固定三步

```bash
# 1. 删 MODULE_DEF 里的那一行
# 2. 删 <section id="av-xxx"> 整块
# 3. 删渲染函数 + 相关事件绑定
grep -n "renderXxx\|av-xxx" app.html
```

⚠️ 如果别的模块引用了它的数据（比如「成绩」引用「组卷」的试卷列表），要先清理引用，否则会出现 `undefined.map()` 白屏。

## 阶段 4 · 视觉适配

模板的视觉层是**追加式**的（V4 + V5 两段，合计约 800 行 CSS）。换业务时：

1. **不要删老样式**，只在末尾追加新段
2. 改主色只改 `:root` 里的 `--accent` 一组变量（`--accent` / `--accent-soft` / `--accent-bg` / `--accent-deep` 要一起改，否则按钮和标签颜色不一致）
3. 新增的表格/表单会自动继承现有样式，只要 class 用对

配色变量：

```css
:root{
  --bg:#F4F7F6;  --surface:#FFFFFF;  --ink:#0F172A;  --muted:#64748B;
  --line:#E3E9E7;  --accent:#0F766E;  --accent-soft:#B7DFD8;
  --accent-bg:#E7F3F0;  --accent-deep:#0B5F58;  --radius:14px;
}
```

## 阶段 5 · 清理与改名

```bash
# 1. 品牌名全局替换（含 title / manifest / 启动脚本 / 导出文件名）
grep -c "原品牌名" app.html server.js manifest.json sw.js

# 2. 删掉示例业务残留
grep -n "考试\|题目\|试卷\|成绩\|学员" app.html | head -40

# 3. 脱敏
python ../../scripts/sanitize_check.py .
```

## 工作量参考

按实际做过的项目估算（一个人，熟悉这套栈之后）：

| 项目类型 | 改造强度 | 时间 |
|---|---|---|
| 客户巡检系统（30 人） | B | 2 天 |
| 门店检查打分表 | A | 半天 |
| 设备点检（含照片上传） | B+ | 3 天 |
| 客户跟进 CRM | C | 5 天 |
| 进销存（含库存计算） | C+ | 7 天 |

**超过 7 天就该考虑用现成的开源 ERP 了**，不要为了「技术统一」硬套。

## 常见错误

| 错误 | 后果 | 正确做法 |
|---|---|---|
| 一次把 12 个模块全改 | 改到第 6 个时不知道哪里坏了 | 改一个跑一次冒烟 |
| 删了 `MODULE_DEF` 但留着 section | 页面上有内容但侧栏点不进去 | 两处必须同时删 |
| 改数据模型没改前端渲染 | `undefined.map()` 白屏 | 全局 grep 旧 key 名，改干净 |
| 新模块没加到 `MOD_PRESET` | 预设切换后新模块被关掉 | 记得加进对应预设的数组 |
| 直接改 `:root` 的 `--bg` | 卡片和背景同色，层次全没了 | 背景压深一级，卡片保持白 |
