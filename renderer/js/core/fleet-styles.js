// fleet-styles.js — FleetStyles.picker for Settings › Style. The kit below is pasted in by
// ~/Nexus/scripts/sync-styles.sh from the shared copy; don't edit between the markers.

/* fleet-styles:begin js */
/* Fleet styles kit v1 (script half). Copy kept in Nexus/styles. Only the Settings page needs it; the pages that
   wear a style get <html data-style> from Swift (FleetStyles.wear) and need only the CSS half.
   FleetStyles.picker(box, styles, current, onPick)   draws the Style cards (radios, name=uiStyle) into box the first
       time and ticks `current` every time; styles = [{ id, name, blurb }] from the app (FleetStyles.list in Swift).
       onPick(id) runs when the user picks one: post it to the app the way the page posts its other settings.
   FleetStyles.picked(box)   the ticked style's id */
window.FleetStyles = window.FleetStyles || (function () {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  function picker(box, styles, current, onPick) {
    if (!box) return;
    box.classList.add("st-grid");
    if (!box.childElementCount) {
      for (const { id, name, blurb } of styles || []) {
        const input = el("input"); input.type = "radio"; input.name = "uiStyle"; input.value = id;
        input.addEventListener("change", e => { e.stopPropagation(); if (input.checked && onPick) onPick(id); });
        const pv = el("div", "st-pv st-" + id), card = el("b", "c");
        card.append(el("i"), el("i"));
        pv.append(el("b", "h"), card, el("b", "k"), el("b", "p"));
        const label = el("label"); label.title = blurb || "";
        label.append(input, pv, el("span", "st-n", name), el("span", "st-d", blurb));
        box.append(label);
      }
    }
    for (const i of box.querySelectorAll("input[name=uiStyle]")) i.checked = i.value === current;
  }
  const picked = box => ((box || document).querySelector("input[name=uiStyle]:checked") || {}).value;
  return { picker, picked };
})();
/* fleet-styles:end js */
