// iOS Safari doesn't resize the page when the keyboard opens: it only pans toward the input,
// which left a side chat's composer under the keyboard. The app follows the visible area
// instead, so the composer always sits right above the keyboard, in every chat. Sheets are
// fixed-position overlays sized by the layout viewport (the keyboard doesn't shrink it), so
// they read the visible height from --visible-height, and a field that gets focus is brought
// to the middle of what is visible.
export function fitToVisibleArea() {
  if (typeof window === "undefined" || !window.visualViewport) return;
  const viewport = window.visualViewport;
  let frame = 0;
  const apply = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const height = `${Math.round(viewport.height)}px`;
      document.documentElement.style.setProperty("--visible-height", height);
      for (const element of [
        document.documentElement,
        document.body,
        document.getElementById("root"),
      ])
        if (element && element.style.height !== height) element.style.height = height;
      // The page never pans away from the top; the app itself is the visible area.
      if (window.scrollY || viewport.offsetTop) window.scrollTo(0, 0);
    });
  };
  viewport.addEventListener("resize", apply);
  viewport.addEventListener("scroll", apply);
  // Once the keyboard is up (the viewport has shrunk), show the focused field inside its
  // scrolling sheet or screen instead of leaving it under the keyboard.
  document.addEventListener("focusin", (event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
    setTimeout(() => {
      if (document.activeElement !== field) return;
      const box = field.getBoundingClientRect();
      if (box.top < 0 || box.bottom > viewport.height)
        field.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 350);
  });
  apply();
}
