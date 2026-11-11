import logoMark from "../assets/logo-mark.png";

/*
 * The launcher's logo, faint behind a page's content. It goes first in the part of the page
 * that doesn't scroll (a position: relative box), so it stays put while the page scrolls;
 * on a page with a right-hand column, that's the central panel. The picture has no
 * background of its own, so no box shows around it, and it's sized from the box it's in,
 * as large as fits there once turned, the same way on every page.
 */
export default function BackgroundLogo() {
  return (
    <div
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0, containerType: "size" }}
    >
      <img
        src={logoMark}
        alt=""
        draggable={false}
        data-testid="background-logo"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%) rotate(-18deg)",
          // Turned, it's about 1.23 times as wide and 1.17 times as tall as this width.
          width: "min(74cqw, 78cqh)",
          height: "auto",
          opacity: 0.12,
          filter: "drop-shadow(0 0 40px rgba(168, 85, 247, 0.3))",
          userSelect: "none",
        }}
      />
    </div>
  );
}
