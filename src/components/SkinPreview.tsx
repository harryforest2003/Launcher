import { useEffect, useRef, useState } from "react";
import { SkinViewer } from "skinview3d";
import Button from "./ui/Button";

type Props = {
    skin: string;
    /** Left out, the arm model is worked out from the texture itself. */
    slim?: boolean;
    size?: number;
    height?: number;
    /** Shows the whole player, instead of a close-up. */
    fullBody?: boolean;
    /** Can't be dragged round or zoomed. */
    still?: boolean;
    /** Turns the head, and a little of the body, towards the mouse. */
    followCursor?: boolean;
    cape?: string | null;
    /** Turns slowly round on its own. */
    spin?: boolean;
    /** Fills the box it's in, and follows its size, instead of `size` by `height`. */
    fill?: boolean;
};

// How far the player turns at most, in radians.
const MAX_TURN = 0.75;
const MAX_NOD = 0.45;
// Of a turn towards the cursor, how much the body does. The head does the rest.
const BODY_SHARE = 0.35;
// Each frame closes this much of the gap to where it's looking, so it eases round.
const EASING = 0.12;

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

export default function SkinPreview({
    skin,
    slim,
    size = 220,
    height = size,
    fullBody = false,
    still = false,
    followCursor = false,
    cape = null,
    spin = false,
    fill = false,
}: Props) {

    const [failedSkin, setFailedSkin] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {

        const container = containerRef.current;

        if (!container || !skin)
            return;

        const viewer = new SkinViewer({
            canvas: document.createElement("canvas"),
            width: fill ? Math.max(container.clientWidth, 1) : size,
            height: fill ? Math.max(container.clientHeight, 1) : height,
            // `playerObject.skin.slim` is private in skinview3d 3.x.
            // The supported way to pick the arm model is this option.
            model: slim === undefined ? "auto-detect" : slim ? "slim" : "default",
        });

        container.appendChild(viewer.canvas);
        let disposed = false;
        // Load the image before handing it to the viewer so an obsolete request cannot
        // recreate GPU textures after the previous viewer has been disposed.
        const texture = new Image();
        texture.crossOrigin = "anonymous";
        texture.onload = () => {
            if (disposed) return;
            try {
                viewer.loadSkin(texture, {
                    model: slim === undefined ? "auto-detect" : slim ? "slim" : "default",
                });
                setFailedSkin(null);
            } catch {
                setFailedSkin(skin);
            }
        };
        texture.onerror = () => {
            if (!disposed) setFailedSkin(skin);
        };
        texture.src = skin.replace(/^http:\/\//, "https://");
        const motion = window.matchMedia("(prefers-reduced-motion: reduce)");


        if (cape) {
            // A missing cape only leaves the back bare, so a failed load is ignored.
            Promise.resolve(viewer.loadCape(cape.replace(/^http:\/\//, "https://"))).catch(() => {});
        }

        viewer.animation = null;

        if (fullBody) {
            // The direction comes first: the field of view and zoom then set the
            // distance along it, far enough back for the whole player to fit.
            viewer.camera.position.set(0, 4, 40);
            viewer.fov = 30;
            viewer.zoom = 0.85;
        } else {
            viewer.fov = 35;
            viewer.zoom = 0.9;
            viewer.camera.position.set(0, 18, 35);
        }

        if (still) {
            viewer.controls.enabled = false;
        } else {
            // It can be spun round, and nothing else: no zooming, sliding or tipping over.
            viewer.controls.enableZoom = false;
            viewer.controls.enablePan = false;
            viewer.controls.update();
            const level = viewer.controls.getPolarAngle();
            viewer.controls.minPolarAngle = level;
            viewer.controls.maxPolarAngle = level;
        }

        // Following the box's size, when it fills one.
        const resized = fill
            ? new ResizeObserver(() => {
                  if (container.clientWidth && container.clientHeight) viewer.setSize(container.clientWidth, container.clientHeight);
              })
            : null;
        resized?.observe(container);

        viewer.autoRotateSpeed = 0.8;

        let frame = 0;
        const looking = { turn: 0, nod: 0 };

        const lookAt = (event: MouseEvent) => {
            const box = viewer.canvas.getBoundingClientRect();

            // Measured from the head, which sits near the top of the picture.
            const across = (event.clientX - (box.left + box.width / 2)) / (window.innerWidth / 2);
            const down = (event.clientY - (box.top + box.height * 0.3)) / (window.innerHeight / 2);

            looking.turn = clamp(across) * MAX_TURN;
            looking.nod = clamp(down) * MAX_NOD;
        };

        const ease = () => {
            const { playerObject } = viewer;
            const { head } = playerObject.skin;

            playerObject.rotation.y += (looking.turn * BODY_SHARE - playerObject.rotation.y) * EASING;
            head.rotation.y += (looking.turn * (1 - BODY_SHARE) - head.rotation.y) * EASING;
            head.rotation.x += (looking.nod - head.rotation.x) * EASING;

            frame = requestAnimationFrame(ease);
        };

        const updateMotion = () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("mousemove", lookAt);
            viewer.renderPaused = document.hidden;
            viewer.autoRotate = spin && !motion.matches && !document.hidden;
            if (followCursor && !motion.matches && !document.hidden) {
                window.addEventListener("mousemove", lookAt);
                frame = requestAnimationFrame(ease);
            }
        };
        motion.addEventListener("change", updateMotion);
        document.addEventListener("visibilitychange", updateMotion);
        updateMotion();

        return () => {
            disposed = true;
            texture.onload = null;
            texture.onerror = null;
            document.removeEventListener("visibilitychange", updateMotion);
            motion.removeEventListener("change", updateMotion);
            resized?.disconnect();
            window.removeEventListener("mousemove", lookAt);
            cancelAnimationFrame(frame);
            viewer.dispose();
            viewer.canvas.remove();
        };
    }, [skin, slim, size, height, fullBody, still, followCursor, cape, spin, fill, attempt]);

    return (
        <div style={{ position: "relative", width: "100%", height: fill ? "100%" : height }}>
            {failedSkin === skin && (
                <div role="status" style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", gap: 12, textAlign: "center" }}>
                    <span>Your skin could not be loaded.</span>
                    <Button size="sm" onClick={() => setAttempt((current) => current + 1)}>Retry skin</Button>
                </div>
            )}
            <div
                ref={containerRef}
                style={{
                    visibility: failedSkin === skin ? "hidden" : "visible",
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    borderRadius: "14px",
                }}
            />
        </div>
    );
}
