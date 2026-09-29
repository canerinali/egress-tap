#!/usr/bin/env python3
"""Render demo/demo.gif from REAL egress-tap output, without vhs.

demo/out1.txt and demo/out2.txt are captured by actually running the CLI in
examples/fake-agent (see "capture" below); nothing in them is hand-written.
egress-tap prints no ANSI colours, so output is drawn plain. The only tint is
on the suspicious-host lines, which are the payoff of the demo.

capture (from the repo root, after `npm install && npm run build`):
  cd examples/fake-agent && rm -rf .egress-tap
  NO_COLOR=1 node ../../dist/cli.js --name demo -- node --no-warnings agent.mjs > ../../demo/out1.txt 2>&1
  NO_COLOR=1 node ../../dist/cli.js emit --format claude demo > ../../demo/out2.txt 2>&1
  rm -rf .egress-tap && cd ../..

render:
  python3 demo/make-gif.py        # needs Pillow and ffmpeg; writes demo/demo.gif
"""
import pathlib
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

DEMO = pathlib.Path(__file__).parent

FONT_REG = "/usr/share/fonts/TTF/JetBrainsMonoNerdFontMono-Regular.ttf"
FONT_BOLD = "/usr/share/fonts/TTF/JetBrainsMonoNerdFontMono-Bold.ttf"
FONT_SIZE = 14
LINE_H = 20
PAD = 20
FPS = 15

BG = (30, 30, 46)
FG = (205, 214, 244)
GREEN = (166, 227, 161)
BLUE = (137, 180, 250)
RED = (243, 139, 168)
YELLOW = (249, 226, 175)

PROMPT_DIR = "~/fake-agent"
PROMPT_SIGN = " $ "

FONT = ImageFont.truetype(FONT_REG, FONT_SIZE)
BOLD = ImageFont.truetype(FONT_BOLD, FONT_SIZE)
CHAR_W = FONT.getlength("M")


def read(name):
    return (DEMO / name).read_text().rstrip("\n").split("\n")


CMD1 = "egress-tap --name demo -- node --no-warnings agent.mjs"
CMD2 = "egress-tap emit --format claude demo"
OUT1 = read("out1.txt")
OUT2 = read("out2.txt")

# Each scene starts on a cleared screen (the tape runs `clear` between them).
SCENES = [
    {"cmd": CMD1, "out": OUT1, "line_delay": 0.22, "hold": 2.5},
    {"cmd": CMD2, "out": OUT2, "line_delay": 0.0, "hold": 7.0},
]

prompt_len = len(PROMPT_DIR) + len(PROMPT_SIGN)
COLS = max(
    max(len(l) for s in SCENES for l in s["out"]),
    max(prompt_len + len(s["cmd"]) for s in SCENES),
) + 2
ROWS = max(2 + len(s["out"]) for s in SCENES)
W = int(PAD * 2 + CHAR_W * COLS)
H = PAD * 2 + LINE_H * ROWS


def colour_for(line):
    if "suspicious" in line or "OMITTED" in line:
        return RED, BOLD
    if line.lstrip().startswith("WARNING"):
        return YELLOW, FONT
    return FG, FONT


def draw_prompt(d, y, text, cursor):
    x = PAD
    d.text((x, y), PROMPT_DIR, font=BOLD, fill=GREEN)
    x += CHAR_W * len(PROMPT_DIR)
    d.text((x, y), PROMPT_SIGN, font=FONT, fill=BLUE)
    x += CHAR_W * len(PROMPT_SIGN)
    d.text((x, y), text, font=FONT, fill=FG)
    if cursor:
        cx = x + CHAR_W * len(text)
        d.rectangle([cx, y + 2, cx + CHAR_W - 1, y + LINE_H - 4], fill=FG)


def render(cmd, out_lines, typing=None):
    """cmd: committed command or None; typing: text at the live prompt or None."""
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    y = PAD
    if cmd is not None:
        draw_prompt(d, y, cmd, cursor=False)
        y += LINE_H
        for line in out_lines:
            col, fnt = colour_for(line)
            d.text((PAD, y), line, font=fnt, fill=col)
            y += LINE_H
    if typing is not None:
        draw_prompt(d, y, typing, cursor=True)
    return img


def main():
    with tempfile.TemporaryDirectory() as tmp:
        frames = pathlib.Path(tmp)
        n = 0

        def emit(img, seconds):
            nonlocal n
            for _ in range(max(1, round(FPS * seconds))):
                img.save(frames / f"f{n:05d}.png")
                n += 1

        for scene in SCENES:
            cmd = scene["cmd"]
            emit(render(None, [], typing=""), 0.5)
            for i in range(3, len(cmd) + 3, 3):
                emit(render(None, [], typing=cmd[:i]), 1 / FPS)
            emit(render(None, [], typing=cmd), 0.35)
            if scene["line_delay"]:
                for k in range(1, len(scene["out"]) + 1):
                    emit(render(cmd, scene["out"][:k]), scene["line_delay"])
            emit(render(cmd, scene["out"], typing=""), scene["hold"])

        print(f"{n} frames, {W}x{H}, ~{n / FPS:.1f}s", file=sys.stderr)
        palette = frames / "palette.png"
        out = DEMO / "demo.gif"
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS),
            "-i", str(frames / "f%05d.png"),
            "-vf", "palettegen=max_colors=64:stats_mode=diff", str(palette),
        ], check=True)
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS),
            "-i", str(frames / "f%05d.png"), "-i", str(palette),
            "-lavfi", "paletteuse=dither=none:diff_mode=rectangle",
            "-loop", "0", str(out),
        ], check=True)
        print(out)


if __name__ == "__main__":
    main()
