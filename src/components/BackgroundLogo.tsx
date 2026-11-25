import logoMark from "../assets/logo-mark.png";
import "./ui/ui.css";

/*
 * The launcher's logo, faint behind a page's content. It goes first in the part of the page
 * that doesn't scroll (a position: relative box), so it stays put while the page scrolls;
 * on a page with a right-hand column, that's the central panel. The picture has no
 * background of its own, so no box shows around it, and it's sized from the box it's in,
 * as large as fits there once turned, the same way on every page. It takes on the colour
 * the user picked (inside .app-logo-tint the wrapper does that instead).
 * Pages that are mostly a grid or list of things (the Library, Discover) leave it out, so
 * nothing shows through behind their pictures and rows.
 */
export default function BackgroundLogo() {
  return (
    <div aria-hidden="true" className="ui-bg-logo">
      <img src={logoMark} alt="" draggable={false} data-testid="background-logo" className="ui-bg-logo__img" />
    </div>
  );
}
