"""產生 90 秒 Demo 的旁白音檔（public/audio/demo01.mp3 ～ demoNN.mp3）。

從 public/demo.html 的 SCENES 讀出每一幕的標題 h 與說明 p，
用台灣中文語音「曉臻」（zh-TW-HsiaoChenNeural）、語速 +10% 念「h。p」。
改了旁白文字之後重跑一次，再 commit、push。

用法：
    python -m pip install --target .tts edge-tts      # 第一次，裝在專案的 .tts 資料夾
    PYTHONPATH=.tts python tools/build-demo-audio.py

注意：edge-tts 使用 Edge「大聲朗讀」的語音服務（非官方開發者介面），適合課程示範；
正式上線請改用 Azure 語音服務（同樣的聲音、正式授權）。
"""
import asyncio
import pathlib
import re
import sys

import edge_tts

VOICE = "zh-TW-HsiaoChenNeural"
RATE = "+10%"
ROOT = pathlib.Path(__file__).resolve().parent.parent
DEMO = ROOT / "public" / "demo.html"
OUT = ROOT / "public" / "audio"


def scenes():
    src = DEMO.read_text(encoding="utf-8")
    block = src[src.index("const SCENES = ["): src.index("];", src.index("const SCENES = ["))]
    items = re.findall(r'h:"([^"]*)",\s*p:"([^"]*)"', block)
    if not items:
        sys.exit("在 demo.html 找不到 SCENES")
    return items


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    items = scenes()
    for n, (h, p) in enumerate(items, 1):
        path = OUT / f"demo{n:02d}.mp3"
        await edge_tts.Communicate(f"{h}。{p}", VOICE, rate=RATE).save(str(path))
        print(f"{path.name}  {path.stat().st_size // 1024} KB  {h}")
    # 清掉多出來的舊檔（幕數變少時）
    for old in OUT.glob("demo*.mp3"):
        if int(old.stem[4:]) > len(items):
            old.unlink()
            print("刪除", old.name)
    print(f"完成：{len(items)} 幕，語音 {VOICE}，語速 {RATE}")


asyncio.run(main())
