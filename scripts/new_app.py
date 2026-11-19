#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从模板生成一个新的后台系统项目。

用法：
    python new_app.py ../my-app --brand "某某云" --sub "设备巡检系统" --port 3000
    python new_app.py ../my-app --brand "Acme"  --color 2563EB

参数全部可选。不传就用模板原值（轻舟AI / 培训考核系统 / 3000 / 墨绿）。
"""

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TEMPLATE_APP = ROOT / "template-app"
TEMPLATE_EL = ROOT / "template-electron"
# 兼容旧结构（assets/template/{app,electron}），有就用旧的
_LEGACY = ROOT / "assets" / "template"
if _LEGACY.is_dir():
    TEMPLATE_APP = _LEGACY / "app"
    TEMPLATE_EL = _LEGACY / "electron"

BRAND_OLD = "轻舟AI"
SUB_OLD = "培训考核系统"
PORT_OLD = "3000"
COLOR_OLD = "0F766E"


# ---------- 颜色工具 ----------

def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb2hex(r, g, b):
    return "%02X%02X%02X" % (max(0, min(255, round(r))),
                             max(0, min(255, round(g))),
                             max(0, min(255, round(b))))


def mix(base, target, ratio):
    """把 base 往 target 混合 ratio（0~1）"""
    b, t = hex2rgb(base), hex2rgb(target)
    return rgb2hex(*[b[i] + (t[i] - b[i]) * ratio for i in range(3)])


def scale(h, k):
    """整体缩放亮度（k<1 变暗）"""
    return rgb2hex(*[c * k for c in hex2rgb(h)])


def palette(accent):
    """给定主色，生成一整套协调的色阶"""
    a = accent.lstrip("#").upper()
    deep = mix(a, "000000", 0.22)
    return {
        "accent": a,
        "soft": mix(a, "FFFFFF", 0.72),      # 浅色描边/标签底
        "bg": mix(a, "FFFFFF", 0.92),        # 极浅背景
        "deep": deep,                        # 深色（hover / 强调）
        "second": mix(a, "0D9488", 0.35),    # 次级强调
        # 首页深色开场背景的三档
        "dark1": scale(deep, 0.30),
        "dark2": scale(deep, 0.38),
        "dark3": scale(deep, 0.46),
    }


def color_map(accent):
    """
    模板视觉层里有一批硬编码的墨绿色值（不在 :root 里）。
    换主色时必须一并映射，否则只有 --accent 生效，界面还是绿的。
    键 = 模板原始色（大写、不带 #），值 = 新色。
    """
    p = palette(accent)
    a = p["accent"]
    return {
        "0F766E": a,
        "0B5F58": p["deep"],
        "14998F": mix(a, "FFFFFF", 0.18),
        "0D9488": p["second"],
        "B7DFD8": p["soft"],
        "E7F3F0": p["bg"],
        # 首页粒子 / 渐隐用的青绿
        "5EEAD4": mix(a, "FFFFFF", 0.58),
        "94EADC": mix(a, "FFFFFF", 0.55),
        "99F6E4": mix(a, "FFFFFF", 0.62),
        "2DD4BF": mix(a, "FFFFFF", 0.30),
        "CCFBF1": mix(a, "FFFFFF", 0.80),
        "EAFBF7": mix(a, "FFFFFF", 0.88),
        # 首页深色开场背景
        "05231F": p["dark1"],
        "08302B": p["dark2"],
        "0A3A33": p["dark3"],
        # 中性底色（原本带墨绿倾向，跟主色一起微调才不脏）
        "F4F7F6": mix(a, "FFFFFF", 0.965),
        "EFF4F2": mix(a, "FFFFFF", 0.950),
        "F1F5F3": mix(a, "FFFFFF", 0.955),
        "E3E9E7": mix(a, "FFFFFF", 0.905),
    }


# ---------- 主流程 ----------

def fail(msg):
    print("✗ " + msg, file=sys.stderr)
    sys.exit(1)


def replace_in(path: Path, pairs):
    if not path.exists():
        return 0
    src = path.read_text(encoding="utf-8")
    out = src
    hit = 0
    for old, new in pairs:
        n = out.count(old)
        if n:
            out = out.replace(old, new)
            hit += n
    if out != src:
        path.write_text(out, encoding="utf-8")
    return hit


def main():
    ap = argparse.ArgumentParser(description="从模板生成新项目")
    ap.add_argument("target", help="目标目录")
    ap.add_argument("--brand", default=BRAND_OLD, help="产品名")
    ap.add_argument("--name", default="", help="英文短名（appId / 数据目录 / 包名）；中文品牌建议指定，如 yunxunjian")
    ap.add_argument("--sub", default=SUB_OLD, help="副标题")
    ap.add_argument("--company", default="", help="公司名（写入安装包版权）")
    ap.add_argument("--port", default=PORT_OLD, help="默认端口")
    ap.add_argument("--color", default=COLOR_OLD, help="主色 hex，如 0F766E")
    ap.add_argument("--force", action="store_true", help="目标目录非空也覆盖")
    args = ap.parse_args()

    if not TEMPLATE_APP.is_dir():
        fail("找不到模板目录：" + str(TEMPLATE_APP))

    target = Path(args.target).resolve()
    if target.exists() and any(target.iterdir()) and not args.force:
        fail("目标目录非空：" + str(target) + "（加 --force 覆盖）")

    print("模板：" + str(TEMPLATE_APP) + " + " + str(TEMPLATE_EL))
    print("目标：" + str(target))

    # 1) 复制（模板是平铺的两块，落地时组装成 项目/app + 项目/electron）
    if target.exists() and args.force:
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)
    shutil.copytree(TEMPLATE_APP, target / "app")
    shutil.copytree(TEMPLATE_EL, target / "electron")

    app_dir = target / "app"
    html = app_dir / "app.html"
    server = app_dir / "server.js"
    manifest = app_dir / "manifest.json"
    bat = app_dir / "start.bat"
    el_pkg = target / "electron" / "package.json"
    el_main = target / "electron" / "main.js"
    el_res = target / "electron" / "resources"

    # electron-builder 认 build/icon.ico，模板里图标平铺在 electron/ 根，这里归位
    el_build = target / "electron" / "build"
    el_build.mkdir(parents=True, exist_ok=True)
    for ico in ("icon.ico", "installer.ico"):
        src_ico = target / "electron" / ico
        if src_ico.exists():
            shutil.move(str(src_ico), str(el_build / ico))

    # 英文短名：用于 exe 文件名、appId、userData 目录名
    slug = re.sub(r"[^a-z0-9]", "", (args.name or "").lower())
    if not slug:
        slug = re.sub(r"[^a-z0-9]", "", args.brand.lower())
    if not slug:
        slug = re.sub(r"[^a-z0-9]", "", target.name.lower())
    if not slug:
        slug = "myapp"
    data_dir = slug.capitalize()

    if not html.exists():
        fail("模板结构异常，缺少 app.html")

    # 2) 品牌与副标题
    pairs = [(BRAND_OLD, args.brand), (SUB_OLD, args.sub)]
    n1 = replace_in(html, pairs)
    n2 = replace_in(server, pairs)
    n3 = replace_in(manifest, pairs)
    n4 = replace_in(bat, [(BRAND_OLD, args.brand)])
    # 主进程：窗口标题 + 版本号 + 独立数据目录（否则不同产品共用一个库）
    n5 = replace_in(el_main, pairs + [("V3.4.0", "V1.0.0"),
                                      ("'QingzhouHR'", "'" + data_dir + "'"),
                                      ("['壹万柒客服考试系统', 'ywx-exam-desktop']", "[]")])
    print("\n品牌替换：app.html %d 处 / server.js %d / manifest %d / bat %d / main.js %d"
          % (n1, n2, n3, n4, n5))
    print("数据目录：%%APPDATA%%\\%s（各产品独立，不会串库）" % data_dir)

    # 3) manifest 的 name / short_name 单独收紧
    if manifest.exists():
        try:
            m = json.loads(manifest.read_text(encoding="utf-8"))
            m["name"] = args.brand + " · " + args.sub
            m["short_name"] = args.brand
            m["version"] = "1.0.0"
            manifest.write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding="utf-8")
        except json.JSONDecodeError:
            pass

    # 3.5) 启动脚本的英文标题
    if bat.exists():
        b = bat.read_text(encoding="utf-8", errors="ignore")
        b = b.replace("YiWanQi Customer Service Exam System",
                      "%s - %s" % (args.brand, args.sub))
        b = b.replace("title ExamServer", "title " + args.brand + " Server")
        b = b.replace("title YiWanQi Exam System - Server",
                      "title " + args.brand + " Server")
        bat.write_text(b, encoding="utf-8")

    # 3.6) 生成 electron/resources：没有这一步，打出来的 exe 是白屏
    if el_res.exists():
        shutil.rmtree(el_res)
    el_res.mkdir(parents=True, exist_ok=True)
    need = ["server.js", "app.html", "manifest.json", "sw.js", "icon-192.png", "icon-512.png"]
    copied = 0
    for name in need:
        src = app_dir / name
        if src.exists():
            shutil.copy2(src, el_res / name)
            copied += 1
    if (app_dir / "data.json").exists():
        shutil.copy2(app_dir / "data.json", el_res / "data.default.json")
        copied += 1
    print("electron/resources 已生成：%d 个文件（data.json -> data.default.json）" % copied)

    # 4) 端口
    if args.port != PORT_OLD:
        t = server.read_text(encoding="utf-8")
        t = re.sub(r"(const PORT = process\.env\.PORT \|\| )\d+", r"\g<1>" + args.port, t, count=1)
        server.write_text(t, encoding="utf-8")
        # 启动脚本里的 3000 也换
        if bat.exists():
            b = bat.read_text(encoding="utf-8")
            bat.write_text(b.replace("3000", args.port), encoding="utf-8")
        print("端口：3000 → " + args.port)

    # 5) 主色（含视觉层里所有硬编码色值）
    if args.color.lstrip("#").upper() != COLOR_OLD:
        p = palette(args.color)
        t = html.read_text(encoding="utf-8")
        before = t

        # 5.1 :root 里的变量组
        t = re.sub(r"--accent:#[0-9A-Fa-f]{6};\s*--accent-soft:#[0-9A-Fa-f]{6};\s*"
                   r"--accent-2:#[0-9A-Fa-f]{6};\s*--teal:#[0-9A-Fa-f]{6};",
                   "--accent:#%s; --accent-soft:#%s; --accent-2:#%s; --teal:#%s;"
                   % (p["accent"], p["soft"], p["second"], p["second"]), t, count=1)
        t = re.sub(r"--accent-bg:#[0-9A-Fa-f]{6};", "--accent-bg:#%s;" % p["bg"], t, count=1)
        t = re.sub(r"--accent-deep:#[0-9A-Fa-f]{6};", "--accent-deep:#%s;" % p["deep"], t, count=1)

        # 5.2 视觉层里散落的硬编码色（这才是"主色没变"的真凶）
        cmap = color_map(args.color)
        nhex = 0
        for old, new in cmap.items():
            pat = re.compile("#" + old, re.I)
            t, k = pat.subn("#" + new, t)
            nhex += k

        # 5.3 rgba(15,118,110,x) 形式
        rgb_old = hex2rgb(COLOR_OLD)
        rgb_new = hex2rgb(p["accent"])
        pat_rgba = re.compile(r"rgba\(\s*15\s*,\s*118\s*,\s*110\s*,")
        t, nrgba = pat_rgba.subn("rgba(%d,%d,%d," % rgb_new, t)

        # 5.4 粒子色数组是纯数字形式（'94,234,212'），单独映射
        def rgb_str(h):
            r, g, b = hex2rgb(h)
            return "%d,%d,%d" % (r, g, b)
        for old_hex, new_hex in [
            ("5EEAD4", cmap["5EEAD4"]), ("99F6E4", cmap["99F6E4"]),
            ("2DD4BF", cmap["2DD4BF"]), ("CCFBF1", cmap["CCFBF1"]),
        ]:
            t = t.replace(rgb_str(old_hex), rgb_str(new_hex))

        if t == before:
            print("⚠ 主色替换未命中，请手动改 :root 与视觉层里的绿色值")
        else:
            print("主色：#%s → #%s   变量组 + 硬编码 %d 处 + rgba %d 处"
                  % (COLOR_OLD, p["accent"], nhex, nrgba))
        html.write_text(t, encoding="utf-8")

    # 6) Electron 包名
    if el_pkg.exists():
        try:
            pkg = json.loads(el_pkg.read_text(encoding="utf-8"))
            pkg["name"] = slug + "-desktop"
            pkg["version"] = "1.0.0"
            pkg["build"]["productName"] = args.brand
            pkg["build"]["appId"] = "com." + slug + ".desktop"
            if args.company:
                pkg["build"]["copyright"] = "Copyright © 2026 " + args.company
                pkg["author"] = args.company
            el_pkg.write_text(json.dumps(pkg, ensure_ascii=False, indent=2), encoding="utf-8")
            print("Electron：productName = %s / appId = %s" % (pkg["build"]["productName"], pkg["build"]["appId"]))
        except json.JSONDecodeError:
            print("⚠ electron/package.json 解析失败，跳过")

    # 7) 提示
    print("""
────────────────────────────────────────────
生成完成。下一步：

  1. 起服务验证
     cd "%s" && node server.js
     浏览器打开 http://localhost:%s

  2. 改业务（关键）
     先读 references/migration.md，按模块逐个替换。
     改一个跑一次冒烟，别一次全改。

  3. 冒烟测试
     node <skill>/scripts/smoke.js http://localhost:%s

  4. 打包 exe
     cd "%s/electron" && npm install
     ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \\
     node node_modules/electron-builder/cli.js --win

  5. 交付前脱敏
     python <skill>/scripts/sanitize_check.py "%s"
────────────────────────────────────────────
""" % (app_dir, args.port, args.port, target, target))


if __name__ == "__main__":
    main()
