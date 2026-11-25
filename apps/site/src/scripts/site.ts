/*
 * The site's only script, and nothing needs it: without it the install line is selectable text. With it, Copy appears
 * beside the install line.
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
