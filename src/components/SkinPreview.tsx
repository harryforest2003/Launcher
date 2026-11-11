import { useEffect, useRef } from "react";
import { SkinViewer } from "skinview3d";

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

    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {

        const container = containerRef.current;

        if (!container || !skin)
            return;

        const viewer = new SkinViewer({
            canvas: document.createElement("canvas"),
            width: fill ? Math.max(container.clientWidth, 1) : size,
            height: fill ? Math.max(container.clientHeight, 1) : height,
            // Mojang's profile gives http addresses, and only https is certain to load.
            skin: skin.replace(/^http:\/\//, "https://"),
            // `playerObject.skin.slim` is private in skinview3d 3.x.
            // The supported way to pick the arm model is this option.
            model: slim === undefined ? "auto-detect" : slim ? "slim" : "default",
        });

        container.appendChild(viewer.canvas);

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

        if (spin) {
            viewer.autoRotate = true;
            viewer.autoRotateSpeed = 0.8;
        }

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

        if (followCursor) {
            window.addEventListener("mousemove", lookAt);
            frame = requestAnimationFrame(ease);
        }

        return () => {
            resized?.disconnect();
            window.removeEventListener("mousemove", lookAt);
            cancelAnimationFrame(frame);
            viewer.dispose();
            viewer.canvas.remove();
        };

    }, [skin, slim, size, height, fullBody, still, followCursor, cape, spin, fill]);

    return (
        <div
            ref={containerRef}
            style={{
                width: "100%",
                height: fill ? "100%" : height,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                borderRadius: "14px",
            }}
        />
    );

}
