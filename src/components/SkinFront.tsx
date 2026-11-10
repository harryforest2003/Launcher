import { useEffect, useRef } from "react";

type Props = {
  skin: string;
  slim?: boolean;
  /** Screen pixels per skin pixel. */
  scale?: number;
};

/*
 * A flat picture of a skin from the front. Lists of skins use this rather than the 3D
 * viewer, because a page can only hold about sixteen 3D views at once.
 */
export default function SkinFront({ skin, slim = false, scale = 5 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const image = new Image();
    let cancelled = false;

    image.crossOrigin = "anonymous";

    image.onload = () => {
      const canvas = canvasRef.current;
      const g = canvas?.getContext("2d");
      if (cancelled || !canvas || !g) return;

      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, canvas.width, canvas.height);

      // Skins from before 2014 are 64×32, and their left arm and leg mirror the right.
      const legacy = image.height === 32;
      const arm = slim ? 3 : 4;

      const part = (sx: number, sy: number, w: number, h: number, dx: number, dy: number, mirror = false) => {
        if (!mirror) {
          g.drawImage(image, sx, sy, w, h, dx * scale, dy * scale, w * scale, h * scale);
          return;
        }

        g.save();
        g.translate((dx + w) * scale, dy * scale);
        g.scale(-1, 1);
        g.drawImage(image, sx, sy, w, h, 0, 0, w * scale, h * scale);
        g.restore();
      };

      // The player's right side is on the viewer's left.
      part(8, 8, 8, 8, 4, 0);
      part(20, 20, 8, 12, 4, 8);
      part(44, 20, arm, 12, 4 - arm, 8);
      if (legacy) part(44, 20, arm, 12, 12, 8, true);
      else part(36, 52, arm, 12, 12, 8);
      part(4, 20, 4, 12, 4, 20);
      if (legacy) part(4, 20, 4, 12, 8, 20, true);
      else part(20, 52, 4, 12, 8, 20);

      // The second layer: hat, jacket, sleeves and trousers.
      part(40, 8, 8, 8, 4, 0);

      if (!legacy) {
        part(20, 36, 8, 12, 4, 8);
        part(44, 36, arm, 12, 4 - arm, 8);
        part(52, 52, arm, 12, 12, 8);
        part(4, 36, 4, 12, 4, 20);
        part(4, 52, 4, 12, 8, 20);
      }
    };

    image.src = skin.replace(/^http:\/\//, "https://");

    return () => {
      cancelled = true;
    };
  }, [skin, slim, scale]);

  return (
    <canvas
      ref={canvasRef}
      width={16 * scale}
      height={32 * scale}
      style={{ imageRendering: "pixelated", display: "block" }}
    />
  );
}
