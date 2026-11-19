#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
下载 llama.cpp 的 Windows Vulkan 版二进制，裁掉用不上的文件，放到项目里。

用法：
    python fetch_llama.py ../my-app/electron/resources/llama
    python fetch_llama.py ./llama --version b12184 --keep-all

为什么用 Vulkan 版：
    N 卡 / A 卡 / Intel 核显都能加速，一份二进制通吃；纯 CPU 也能回退。
    CUDA 版要绑定具体 CUDA 版本，客户驱动不匹配直接废。

为什么不用官方原始包：
    压缩包里 40+ 个 exe/lib，只有 llama-server.exe 是运行时需要的，
    裁完能从 120MB 降到 89MB。
"""

import argparse
import io
import os
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

MIRRORS = [
    "https://gh-proxy.com/",
    "https://ghfast.top/",
    "",  # 直连，最后兜底
]

BASE = "https://github.com/ggml-org/llama.cpp/releases/download/{ver}/llama-{ver}-bin-win-vulkan-x64.zip"

# 运行时必需（其余一律删掉）
KEEP_PREFIX = ("llama-server", "ggml", "llama.dll", "mtmd", "vulkan-1", "LICENSE", "README")
KEEP_EXT = (".dll", ".exe", ".txt", ".md")


def download(url, dest, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "qingzhou-app-kit"})
    with urllib.request.urlopen(req, timeout=timeout) as r, open(dest, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        got = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            got += len(chunk)
            if total:
                pct = got * 100 // total
                print("\r  下载中 %d%%  %.1f/%.1f MB" % (pct, got / 1048576, total / 1048576), end="")
        print()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out", help="输出目录（一般是 electron/resources/llama）")
    ap.add_argument("--version", default="b12184", help="llama.cpp release tag")
    ap.add_argument("--keep-all", action="store_true", help="不裁剪，保留压缩包全部文件")
    args = ap.parse_args()

    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    zip_path = out.parent / ("llama-%s.zip" % args.version)

    # 1) 下载（依次尝试镜像）
    url_path = BASE.format(ver=args.version)
    ok = False
    for m in MIRRORS:
        full = m + url_path
        print("尝试：" + (m or "直连"))
        try:
            download(full, zip_path)
            if zip_path.stat().st_size > 20 * 1024 * 1024:
                ok = True
                break
            print("  文件太小，换下一个源")
        except Exception as e:
            print("  失败：" + str(e)[:120])
    if not ok:
        print("\n✗ 所有下载源都失败。手动下载后解压到：" + str(out))
        print("  " + url_path)
        sys.exit(1)

    print("已下载 %.1f MB" % (zip_path.stat().st_size / 1048576))

    # 2) 解压 + 裁剪
    kept, dropped = 0, 0
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            name = os.path.basename(info.filename)
            if not args.keep_all:
                low = name.lower()
                if not (low.startswith(KEEP_PREFIX) and low.endswith(KEEP_EXT)):
                    dropped += 1
                    continue
            with z.open(info) as src, open(out / name, "wb") as dst:
                shutil.copyfileobj(src, dst)
            kept += 1

    zip_path.unlink(missing_ok=True)

    size = sum(f.stat().st_size for f in out.iterdir() if f.is_file()) / 1048576
    print("\n✓ 完成：%d 个文件 / %.1f MB（丢掉 %d 个无关文件）" % (kept, size, dropped))
    print("  目录：" + str(out))

    exe = out / "llama-server.exe"
    print("\n下一步：")
    print("  1. 确认 %s 存在" % exe.name)
    print("  2. 把三个许可证文件放进发布包的 第三方许可证/：")
    print("     llama.cpp (MIT) / Qwen3 (Apache-2.0) / LLVM OpenMP (Apache-2.0 with LLVM Exceptions)")
    print("  3. 在 main.js 里把 LLAMA_VERSION 改成 '%s-vulkan'" % args.version)


if __name__ == "__main__":
    main()
