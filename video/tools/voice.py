"""تعليق صوتي عربي مجاني (Microsoft Edge TTS) + توقيت كل كلمة للكابشن.

الاستخدام:
  .venv/bin/python tools/voice.py <اسم> "النص"            → public/voice/<اسم>.mp3 و <اسم>.json
  .venv/bin/python tools/voice.py <اسم> -f script.txt --voice ar-SA-ZariyahNeural --rate +5%
  .venv/bin/python tools/voice.py --voices                 → الأصوات العربية المتاحة

يحتاج إن البيئة تسمح بالدومين speech.platform.bing.com.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path

import edge_tts

OUT = Path(__file__).resolve().parent.parent / "public" / "voice"
# أصوات خليجية: ar-SA-HamedNeural (رجل)، ar-SA-ZariyahNeural (امرأة)، ar-AE-HamdanNeural، ar-KW-FahedNeural …
DEFAULT_VOICE = "ar-SA-HamedNeural"


def proxy():
    return os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")


async def list_voices():
    for v in await edge_tts.list_voices(proxy=proxy()):
        if v["Locale"].startswith("ar-"):
            print(f'{v["ShortName"]:28} {v["Gender"]}')


async def synth(name, text, voice, rate):
    OUT.mkdir(parents=True, exist_ok=True)
    words = []
    com = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary", proxy=proxy())
    with open(OUT / f"{name}.mp3", "wb") as audio:
        async for chunk in com.stream():
            if chunk["type"] == "audio":
                audio.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / 1e7  # الوحدة 100 نانوثانية
                words.append({"text": chunk["text"], "start": round(start, 3),
                              "end": round(start + chunk["duration"] / 1e7, 3)})
    (OUT / f"{name}.json").write_text(json.dumps(words, ensure_ascii=False, indent=1))
    print(f"✓ public/voice/{name}.mp3  ({len(words)} كلمة، {words[-1]['end'] if words else 0:.1f} ث)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name", nargs="?")
    ap.add_argument("text", nargs="?")
    ap.add_argument("-f", "--file")
    ap.add_argument("--voice", default=DEFAULT_VOICE)
    ap.add_argument("--rate", default="+0%")
    ap.add_argument("--voices", action="store_true")
    a = ap.parse_args()
    if a.voices:
        return asyncio.run(list_voices())
    text = Path(a.file).read_text() if a.file else a.text
    if not a.name or not text:
        ap.error("اكتب اسم الملف والنص")
    asyncio.run(synth(a.name, text, a.voice, a.rate))


if __name__ == "__main__":
    main()
