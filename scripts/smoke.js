#!/usr/bin/env node
/**
 * 冒烟测试：登录 → 遍历全部模块 → 抓 JS 报错 → 检测横向溢出
 *
 * 用法：
 *   node smoke.js http://localhost:3000
 *   node smoke.js http://localhost:3000 --user admin01 --pwd 866183
 *   node smoke.js http://localhost:3000 --shots ./shots     # 顺便存截图
 *
 * 依赖 playwright-core + 本机 Edge（Windows 自带，不用下 Chromium）
 *   npm i -g playwright-core   或   在项目里 npm i playwright-core
 *
 * 退出码：0 = 全绿，1 = 有失败项
 */

const fs = require('fs');
const path = require('path');

let chromium;
// 依次尝试：脚本自身位置 → 当前工作目录 → 环境变量 PLAYWRIGHT_CORE
const tryPaths = [
  null,
  path.join(process.cwd(), 'node_modules', 'playwright-core'),
  process.env.PLAYWRIGHT_CORE || '',
];
for (const p of tryPaths) {
  try {
    chromium = (p ? require(p) : require('playwright-core')).chromium;
    if (chromium) break;
  } catch (e) { /* 继续找 */ }
}
if (!chromium) {
  console.error('缺少 playwright-core。三选一：');
  console.error('  在项目目录执行：npm i playwright-core');
  console.error('  全局安装：npm i -g playwright-core');
  console.error('  指定路径：set PLAYWRIGHT_CORE=D:\\path\\to\\playwright-core');
  process.exit(2);
}

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const URL = argv[0] || 'http://localhost:3000';
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const USER = opt('user', 'admin01');
const PWD = opt('pwd', 'admin888');
const SHOTS = opt('shots', '');

if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// ---------- 找本机浏览器 ----------
function findBrowser() {
  const cands = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

const EXE = findBrowser();
if (!EXE) {
  console.error('找不到 Edge / Chrome，请先安装或用环境变量指定');
  process.exit(2);
}

// ---------- 溢出检测 ----------
async function overflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const over = de.scrollWidth - de.clientWidth;
    if (over <= 0) return { over: 0, culprits: [] };
    // 找出把页面撑宽的元素
    const list = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > de.clientWidth + 1) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') continue;
        list.push((el.tagName + '#' + (el.id || '') + '.' + (el.className || '').toString().slice(0, 30)).trim());
        if (list.length >= 5) break;
      }
    }
    return { over, culprits: list };
  });
}

// ---------- 主流程 ----------
(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    headless: true,
    args: ['--no-proxy-server', '--no-sandbox'],
  });

  const errors = [];
  const fails = [];
  let page;

  async function newPage(viewport, isMobile) {
    const ctx = await browser.newContext({ viewport, isMobile: !!isMobile, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push({ url: p.url(), msg: e.message.slice(0, 200) }));
    p.on('console', (m) => { if (m.type() === 'error') errors.push({ url: p.url(), msg: '[console] ' + m.text().slice(0, 160) }); });
    return p;
  }

  // 进入登录页（兼容有开场页的版本）
  async function enter(p) {
    await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(1200);
    const homeVisible = await p.locator('#home').isVisible().catch(() => false);
    if (homeVisible) await p.click('#startBtn').catch(() => {});
    await p.evaluate(() => {
      const lv = document.getElementById('loginView');
      if (lv) lv.classList.remove('hidden');
      const h = document.getElementById('home');
      if (h) { h.classList.add('hidden'); h.classList.remove('active', 'show', 'leaving'); }
    });
    await p.waitForSelector('#loginUser', { state: 'visible', timeout: 15000 });
  }

  async function login(p) {
    await enter(p);
    await p.fill('#loginUser', USER);
    await p.fill('#loginPwd', PWD);
    await p.click('.qzx-login, button[type=submit], .btn-login');
    await p.waitForTimeout(1800);
    const ok = await p.locator('#appView').isVisible().catch(() => false);
    if (!ok) throw new Error('登录失败：没进到 #appView（检查账号密码或登录按钮选择器）');
  }

  // ===== 桌面端 =====
  console.log('=== 桌面 1440×940 ===');
  page = await newPage({ width: 1440, height: 940 });
  await login(page);

  const navs = await page.evaluate(() =>
    [...document.querySelectorAll('#adminLayout .nav-item, #adminNav .nav-item')]
      .map((el) => ({ key: el.dataset.v || '', text: el.textContent.trim() }))
  );
  console.log('侧栏模块 ' + navs.length + ' 个：' + navs.map((n) => n.text).join(' / '));

  for (const nav of navs) {
    const before = errors.length;
    const sel = '#adminLayout .nav-item[data-v="' + nav.key + '"], #adminNav .nav-item[data-v="' + nav.key + '"]';
    await page.click(sel, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(650);

    const r = await overflow(page);
    const newErr = errors.length - before;
    const tag = (r.over > 0 ? '溢出 ' + r.over + 'px' : 'OK') + (newErr ? ' / 报错 ' + newErr : '');
    const bad = r.over > 0 || newErr > 0;
    if (bad) fails.push({ page: nav.text, over: r.over, errs: newErr, culprits: r.culprits });
    console.log('  ' + (bad ? '✗' : '✓') + ' ' + nav.text.padEnd(8) + ' ' + tag
      + (r.culprits.length ? '  ← ' + r.culprits.slice(0, 2).join(', ') : ''));

    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desktop_' + (nav.key || nav.text) + '.png') }).catch(() => {});
  }

  // ===== 手机端 =====
  console.log('\n=== 手机 390×844 ===');
  const m = await newPage({ width: 390, height: 844 }, true);
  await login(m);
  // 回到第一屏
  await m.evaluate(() => { const a = document.getElementById('adminLayout'); if (a) a.scrollTop = 0; });
  await m.waitForTimeout(500);
  const mr = await overflow(m);
  if (mr.over > 0) {
    fails.push({ page: '手机·首屏', over: mr.over, culprits: mr.culprits });
    console.log('  ✗ 首屏溢出 ' + mr.over + 'px  ← ' + mr.culprits.slice(0, 2).join(', '));
  } else {
    console.log('  ✓ 首屏溢出 0px');
  }
  if (SHOTS) await m.screenshot({ path: path.join(SHOTS, 'mobile_home.png'), fullPage: false }).catch(() => {});

  // 手机上逐页只查溢出，不截图
  for (const nav of navs) {
    const sel = '#adminLayout .nav-item[data-v="' + nav.key + '"]';
    await m.click(sel, { timeout: 4000 }).catch(() => {});
    await m.waitForTimeout(500);
    const r = await overflow(m);
    if (r.over > 0) {
      fails.push({ page: '手机·' + nav.text, over: r.over, culprits: r.culprits });
      console.log('  ✗ ' + nav.text.padEnd(8) + ' 溢出 ' + r.over + 'px  ← ' + r.culprits.slice(0, 2).join(', '));
    }
  }

  // ===== 汇总 =====
  console.log('\n================ 结果 ================');
  const uniqErr = [...new Set(errors.map((e) => e.msg))];
  console.log('JS 报错：' + errors.length + ' 条，去重后 ' + uniqErr.length + ' 类');
  uniqErr.slice(0, 8).forEach((e) => console.log('  · ' + e));
  console.log('溢出失败：' + fails.length + ' 项');

  await browser.close();

  if (fails.length || uniqErr.length) {
    console.log('\n✗ 验收不通过，修完再跑。');
    process.exit(1);
  }
  console.log('\n✓ 全部通过');
  process.exit(0);
})().catch((e) => {
  console.error('\n✗ 冒烟中断：' + e.message);
  process.exit(1);
});
