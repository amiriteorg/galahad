/*
 * The site's only script, and nothing needs it: without it the install line is selectable text and the knights blink.
 * With it, Copy appears beside the install line, and the knights that aren't busy follow the pointer with their eyes.
 */

for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-copy]")) {
  const label = button.querySelector<HTMLElement>("[data-copy-label]");
  let reset = 0;
  button.hidden = false;
  button.addEventListener("click", async () => {
    let said = "Copied";
    try {
      await navigator.clipboard.writeText(button.dataset.copy ?? "");
    } catch {
      // No clipboard for this page (an old browser, a refused permission): select the line so a keystroke copies it.
      const line = button.parentElement?.querySelector("code");
      if (line) getSelection()?.selectAllChildren(line);
      said = "Selected";
    }
    if (label) label.textContent = said;
    button.dataset.done = "";
    clearTimeout(reset);
    reset = window.setTimeout(() => {
      if (label) label.textContent = "Copy";
      delete button.dataset.done;
    }, 2000);
  });
}

const followers = [...document.querySelectorAll<HTMLElement>(".knight[data-follow]")];
const still = matchMedia("(prefers-reduced-motion: reduce)");
if (followers.length && matchMedia("(pointer: fine)").matches) {
  let frame = 0;
  let px = 0;
  let py = 0;
  const look = () => {
    frame = 0;
    if (still.matches) return;
    for (const knight of followers) {
      const box = knight.getBoundingClientRect();
      if (box.bottom < 0 || box.top > innerHeight) continue;
      // The eyes sit about two fifths of the way down the drawing; they turn fully once the pointer is 200 px off.
      const dx = px - (box.left + box.width / 2);
      const dy = py - (box.top + box.height * 0.4);
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, d / 200);
      // In the drawing's own units (768 across): about a third of an eye, so it never leaves the slit.
      knight.style.setProperty("--lx", ((dx / d) * reach * 4).toFixed(2));
      knight.style.setProperty("--ly", ((dy / d) * reach * 3).toFixed(2));
    }
  };
  addEventListener(
    "pointermove",
    (event) => {
      px = event.clientX;
      py = event.clientY;
      document.documentElement.dataset.looking = "";
      if (!frame) frame = requestAnimationFrame(look);
    },
    { passive: true },
  );
}
