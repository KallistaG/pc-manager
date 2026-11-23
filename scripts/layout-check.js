// Check the UI layout in a browser (no backend required).
//
// Usage:
//   1. Run `npm run dev` and open http://localhost:1420/?demo&page=dashboard
//   2. Set a window size to test (recommended: 860x560 = app minimum, 1100x720, 1366x768, 1920x1080)
//   3. Paste this entire file into the Console and run `await layoutCheck()`
//
// For every sidebar page in both dark and light themes, report:
//   - horizontal page scrolling; elements overflowing the content area (excluding nested scroll regions);
//   - overlapping buttons, inputs, or selects; clipped button text.
// An empty `issues` array means the layout is clean. (Verified with a 3000px-wide element and overlapping buttons.)

async function layoutCheck() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const main = document.querySelector("main");
  const vis = () => [...main.children].find((d) => !d.hidden);
  const navButtons = [...document.querySelectorAll("nav button")].filter((b) => b.textContent.trim());
  const issues = [];

  const check = (name, theme) => {
    const v = vis();
    const mr = main.getBoundingClientRect();
    if (main.scrollWidth > main.clientWidth + 1) issues.push(`${name}/${theme}: horizontal page scroll (${main.scrollWidth} > ${main.clientWidth})`);
    for (const el of v.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      let p = el.parentElement;
      let clipped = false;
      while (p && p !== main) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) {
          clipped = true;
          break;
        }
        p = p.parentElement;
      }
      if (!clipped && (r.right > mr.right + 1 || r.left < mr.left - 1)) {
        issues.push(`${name}/${theme}: horizontal overflow <${el.tagName.toLowerCase()}> "${(el.textContent || "").trim().slice(0, 40)}"`);
        break;
      }
    }
    const ctrls = [...v.querySelectorAll("button, input:not([type=checkbox]), select")].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    for (let i = 0; i < ctrls.length; i++)
      for (let j = i + 1; j < ctrls.length; j++) {
        const a = ctrls[i];
        const b = ctrls[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (w > 2 && h > 2) issues.push(`${name}/${theme}: overlapping controls "${a.textContent.trim().slice(0, 20) || a.tagName}" × "${b.textContent.trim().slice(0, 20) || b.tagName}"`);
      }
    for (const b of v.querySelectorAll("button"))
      if (b.scrollWidth > b.clientWidth + 1 && b.getBoundingClientRect().width > 0) issues.push(`${name}/${theme}: clipped button text "${b.textContent.trim().slice(0, 30)}"`);
  };

  const original = document.documentElement.dataset.theme;
  for (const theme of ["dark", "light"]) {
    document.documentElement.dataset.theme = theme;
    for (const btn of navButtons) {
      const name = btn.textContent.trim();
      btn.click();
      await wait(500);
      // Populate the Junk Cleaner page with scan results.
      if (name.startsWith("Junk Cleaner")) {
        const scan = [...vis().querySelectorAll("button")].find((x) => /^(Scan now|Scan again)$/.test(x.textContent.trim()));
        if (scan) {
          scan.click();
          await wait(500);
        }
      }
      check(name, theme);
    }
  }
  document.documentElement.dataset.theme = original;
  return { size: `${innerWidth}x${innerHeight}`, issues: [...new Set(issues)] };
}
