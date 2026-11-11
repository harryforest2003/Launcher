"""
Makes every icon and the page background logo from src/assets/logo.png:

  src/assets/logo-mark.png   the logo alone, see-through, for behind pages
  build/icon.png, icon.icns  Mac: a rounded square inside Apple's icon margin, with a shadow
  build/icon.ico             Windows: a rounded square filling the icon, 16 to 256 px
  build/icons/NxN.png        Linux: the same, 16 to 1024 px

Run it again if the logo changes:  python3 scripts/make-icons.py
Needs Pillow and numpy; on a Mac, iconutil makes the .icns.
"""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "src/assets/logo.png"
BUILD = ROOT / "build"


def make_mark():
    """The logo without its dark background: what's dark becomes see-through, edges soft."""
    im = Image.open(LOGO).convert("RGB")
    im = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255.0
    t = np.clip((a.max(axis=2) - 0.30) / (0.60 - 0.30), 0, 1)
    alpha = t * t * (3 - 2 * t)
    h, w = alpha.shape
    y = np.linspace(0, 1, h)[:, None]
    x = np.linspace(0, 1, w)[None, :]
    edge = np.minimum(np.minimum(x, 1 - x) / 0.06, 1) * np.minimum(np.minimum(y, 1 - y) / 0.06, 1)
    alpha *= np.clip(edge, 0, 1)
    out = Image.fromarray((np.dstack([a, alpha]) * 255).round().astype(np.uint8), "RGBA")
    out.save(ROOT / "src/assets/logo-mark.png", optimize=True)
    return out


def tile(mark, size, mark_share):
    """A size x size square: the logo's dark purple, lit from the top left, with the logo on it."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    top = np.array([46, 30, 72], np.float32)
    bottom = np.array([9, 7, 16], np.float32)
    t = np.clip((xx * 0.35 + yy * 0.9) / 1.1, 0, 1)[..., None]
    bg = top * (1 - t) + bottom * t
    glow = np.clip(1 - np.sqrt((xx - 0.52) ** 2 + (yy - 0.5) ** 2) / 0.55, 0, 1)[..., None] ** 2
    bg = bg + glow * np.array([70, 20, 110], np.float32) * 0.55
    square = Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    w = int(size * mark_share)
    m = mark.resize((w, round(mark.height * w / mark.width)), Image.LANCZOS)
    square.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2 + round(size * 6 / 824)))
    return square


def rounded(square, radius, edge_alpha=60):
    """Rounds the square's corners and gives it a faint light edge."""
    size = square.width
    border = Image.new("RGBA", square.size, (0, 0, 0, 0))
    width = max(1, round(size * 3 / 824))
    ImageDraw.Draw(border).rounded_rectangle((1, 1, size - 2, size - 2), radius - 1, outline=(190, 140, 255, edge_alpha), width=width)
    square = square.copy()
    square.alpha_composite(border)
    mask = Image.new("L", square.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius, fill=255)
    square.putalpha(Image.fromarray(np.minimum(np.asarray(square.getchannel("A")), np.asarray(mask))))
    return square


def mac_icon(mark):
    """Apple's grid: an 824 px rounded square in a 1024 px icon, with a soft shadow."""
    S, SQ, R = 1024, 824, 185
    off = (S - SQ) // 2
    square = rounded(tile(mark, SQ, 0.80), R)
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((off, off + 12, off + SQ, off + SQ + 12), R, fill=(0, 0, 0, 110))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)))
    canvas.alpha_composite(square, (off, off))
    return canvas


def flat_icon(mark, size):
    """Windows and Linux: the rounded square fills the icon. Small sizes get a bigger logo."""
    big = 1024
    small = size <= 32
    margin = 0 if small else round(big * 0.03)
    inner = big - 2 * margin
    square = rounded(tile(mark, inner, 0.92 if small else 0.82), round(inner * (0.16 if small else 0.2)), 0 if small else 60)
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    canvas.alpha_composite(square, (margin, margin))
    return canvas.resize((size, size), Image.LANCZOS)


def main():
    BUILD.mkdir(exist_ok=True)
    mark = make_mark()

    mac = mac_icon(mark)
    mac.save(BUILD / "icon.png", optimize=True)
    if shutil.which("iconutil"):
        with tempfile.TemporaryDirectory() as tmp:
            iconset = Path(tmp) / "icon.iconset"
            iconset.mkdir()
            for s in (16, 32, 128, 256, 512):
                mac.resize((s, s), Image.LANCZOS).save(iconset / f"icon_{s}x{s}.png")
                mac.resize((s * 2, s * 2), Image.LANCZOS).save(iconset / f"icon_{s}x{s}@2x.png")
            subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(BUILD / "icon.icns")], check=True)
    else:
        print("iconutil isn't here (it comes with macOS), so build/icon.icns was left as it was.", file=sys.stderr)

    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    ico = [flat_icon(mark, s) for s in ico_sizes]
    ico[-1].save(BUILD / "icon.ico", format="ICO", sizes=[(s, s) for s in ico_sizes], append_images=ico[:-1])

    icons = BUILD / "icons"
    icons.mkdir(exist_ok=True)
    for s in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
        flat_icon(mark, s).save(icons / f"{s}x{s}.png", optimize=True)

    print("Made src/assets/logo-mark.png, build/icon.png, build/icon.icns, build/icon.ico and build/icons/.")


if __name__ == "__main__":
    main()
