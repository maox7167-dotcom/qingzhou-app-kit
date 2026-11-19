#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
交付前脱敏自查。扫项目目录里的文本文件，找出不该带出去的东西。

用法：
    python sanitize_check.py ../my-app
    python sanitize_check.py ../my-app --extra "我的公司名,张三,13800138000"
    python sanitize_check.py ../my-app --json        # 机器可读输出

退出码：0 = 无 ERROR（WARN 不影响），1 = 有 ERROR
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

TEXT_EXT = {".html", ".htm", ".js", ".json", ".txt", ".md", ".bat", ".cmd", ".ps1", ".css", ".yml", ".yaml"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", "__pycache__", ".cache", "win-unpacked"}

# (级别, 名称, 正则, 说明)
RULES = [
    ("ERROR", "OpenAI/DeepSeek 密钥",
     r"sk-[A-Za-z0-9_\-]{20,}",
     "API Key 必须清空，否则随安装包发给客户，会被别人用你的额度"),

    ("ERROR", "Anthropic 密钥",
     r"sk-ant-[A-Za-z0-9_\-]{20,}",
     "同上"),

    ("ERROR", "企业微信/飞书 webhook",
     r"(qyapi\.weixin\.qq\.com/cgi-bin/webhook/send\?key=|open\.feishu\.cn/open-apis/bot/v2/hook/)",
     "群机器人地址外泄 = 任何人可以往你的群里发消息"),

    ("ERROR", "隐藏的 base64 地址",
     r"aHR0cHM6Ly9[A-Za-z0-9+/=]{20,}",
     "base64 编码的 URL，多半是硬编码的上报地址"),

    ("ERROR", "本机绝对路径",
     r"[A-Za-z]:\\\\?Users\\\\?[A-Za-z0-9_.\-]+",
     "暴露开发机用户名，且客户机器上根本不存在这个路径"),

    ("WARN", "手机号",
     r"(?<!\d)1[3-9]\d{9}(?!\d)",
     "看起来像真实手机号，确认不是客户数据"),

    ("WARN", "邮箱",
     r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}",
     "确认不是真实联系人"),

    ("WARN", "身份证号",
     r"(?<!\d)\d{17}[\dXx](?!\d)",
     "真敏感，必须清"),

    ("INFO", "外部链接",
     r"https?://(?!localhost|127\.0\.0\.1|0\.0\.0\.0)[A-Za-z0-9.\-]+",
     "内网客户连不上，每个外链都要确认是否必需"),
]


def scan_file(path: Path, extra_words):
    """返回 [(级别, 名称, 行号, 片段, 说明)]"""
    hits = []
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return hits

    lines = text.splitlines()
    for level, name, pattern, note in RULES:
        rx = re.compile(pattern)
        for i, line in enumerate(lines, 1):
            for m in rx.finditer(line):
                frag = m.group(0)
                # 打码：保留头尾，中间去掉
                shown = frag if len(frag) <= 12 else frag[:6] + "…" + frag[-4:]
                hits.append((level, name, i, shown, note))

    for w in extra_words:
        if not w:
            continue
        for i, line in enumerate(lines, 1):
            if w in line:
                hits.append(("ERROR", "自定义敏感词", i, w, "你指定必须清除的词"))
    return hits


def check_data_json(root: Path):
    """data.json 里的 apiKey 必须为空"""
    out = []
    for p in root.rglob("data*.json"):
        if any(s in p.parts for s in SKIP_DIRS):
            continue
        try:
            j = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        st = j.get("state", j)
        for k, v in (st.items() if isinstance(st, dict) else []):
            if isinstance(v, dict) and v.get("apiKey"):
                out.append(("ERROR", "data.json 里有 API Key", str(p.relative_to(root)),
                            k, "把 ywx_settings.apiKey 置为空字符串"))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target")
    ap.add_argument("--extra", default="", help="额外敏感词，逗号分隔")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    root = Path(args.target).resolve()
    if not root.exists():
        print("目录不存在：" + str(root), file=sys.stderr)
        sys.exit(2)

    extra = [w.strip() for w in args.extra.split(",") if w.strip()]

    all_hits = []
    nfiles = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            p = Path(dirpath) / fn
            if p.suffix.lower() not in TEXT_EXT:
                continue
            nfiles += 1
            for level, name, line, frag, note in scan_file(p, extra):
                all_hits.append({
                    "level": level, "rule": name, "file": str(p.relative_to(root)),
                    "line": line, "frag": frag, "note": note,
                })

    for level, name, f, frag, note in check_data_json(root):
        all_hits.append({"level": level, "rule": name, "file": f, "line": 0, "frag": frag, "note": note})

    if args.json:
        print(json.dumps({"files": nfiles, "hits": all_hits}, ensure_ascii=False, indent=2))
    else:
        order = {"ERROR": 0, "WARN": 1, "INFO": 2}
        all_hits.sort(key=lambda h: (order[h["level"]], h["file"], h["line"]))
        counts = {"ERROR": 0, "WARN": 0, "INFO": 0}
        for h in all_hits:
            counts[h["level"]] += 1

        print("扫描 %d 个文本文件 → %d 条命中（ERROR %d / WARN %d / INFO %d）\n"
              % (nfiles, len(all_hits), counts["ERROR"], counts["WARN"], counts["INFO"]))

        last_rule = None
        for h in all_hits:
            if h["rule"] != last_rule:
                print("【%s】%s" % (h["level"], h["rule"]))
                print("      %s" % h["note"])
                last_rule = h["rule"]
            loc = h["file"] + (":%d" % h["line"] if h["line"] else "")
            print("  - %-40s %s" % (loc, h["frag"]))
        if all_hits:
            print()

        if counts["ERROR"]:
            print("✗ 有 %d 个 ERROR，修完再交付。" % counts["ERROR"])
            sys.exit(1)
        print("✓ 没有 ERROR。WARN 项请逐条确认。")
        sys.exit(0)


if __name__ == "__main__":
    main()
