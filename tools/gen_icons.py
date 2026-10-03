# 重新生成插件图标:蓝底白字“译”(需 Pillow: pip install pillow)
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
os.makedirs(OUT, exist_ok=True)

BG = (22, 119, 255, 255)      # 蓝
FG = (255, 255, 255, 255)

def load_font(size):
    candidates = [
        r"C:\Windows\Fonts\msyhbd.ttc",
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\simsun.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",  # Linux 兜底(无中文则显示方块)
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()

for s in (16, 48, 128):
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = max(3, int(s * 0.22))
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=BG)
    font = load_font(max(8, int(s * 0.62)))
    text = "译"
    try:
        bbox = d.textbbox((0, 0), text, font=font)
        w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        pos = ((s - w) / 2 - bbox[0], (s - h) / 2 - bbox[1])
    except Exception:
        pos = (0, 0)
    d.text(pos, text, font=font, fill=FG)
    img.save(os.path.join(OUT, f"icon{s}.png"))
    print(f"icon{s}.png ok")
print("done")