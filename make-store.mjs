// Renders the Community listing's images with Google Chrome: store/icon.png (128×128) and store/thumbnail.png
// (1920×1080), from the brand mark and the site's type. Run after changing the words: node make-store.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const font = pathToFileURL("../site/public/fonts/archivo-latin-wdth-normal.woff2").href;
mkdirSync("store", { recursive: true });

// The mark without its own rounded square: Figma rounds the icon itself.
const mark = (size, stroke, line) => `<svg width="${size}" height="${size}" viewBox="0 0 28 28" fill="none">
  <path d="M6 18.5v-3a8 8 0 0 1 16 0v3" stroke="#B0802A" stroke-width="${stroke}" stroke-linecap="round"/>
  <path d="M4.5 19h19" stroke="${line}" stroke-width="${stroke}" stroke-linecap="round"/>
</svg>`;

function render(name, width, height, body, css) {
  const html = `.${name}.html`;
  writeFileSync(html, `<!doctype html>
<meta charset="utf-8">
<style>
@font-face { font-family: Archivo; src: url("${font}") format("woff2"); font-weight: 100 900; font-stretch: 62% 125%; }
html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; font-family: Archivo, sans-serif; }
${css}
</style>
${body}`);
  execFileSync(chrome, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    `--window-size=${width},${height}`, "--virtual-time-budget=3000", `--screenshot=store/${name}.png`, pathToFileURL(html).href,
  ], { stdio: "ignore" });
  unlinkSync(html);
  console.log(`store/${name}.png`);
}

render("icon", 128, 128,
  `<div class="icon">${mark(128, 2.4, "#FFFFFF")}</div>`,
  `body { background: #13232F; } .icon { display: flex; width: 128px; height: 128px; align-items: center; justify-content: center; }`);

render("thumbnail", 1920, 1080,
  `<div class="card">
    <div class="brand">${mark(72, 2.4, "#FFFFFF")}<span>Brua</span></div>
    <div class="text">
      <h1>Publish a frame to Brua and hand developers an id, not a file.</h1>
      <p>Alt text in every language, every size and format, dark mode and localization, released after review. The id stays; the design moves on.</p>
    </div>
    <div class="window" aria-hidden="true">
      <div class="bar"><span></span><span></span><span></span></div>
      <div class="row"><b>hero-banner</b><em>1280 × 640</em></div>
      <div class="field"><small>Alt text, English</small>A red wool blanket folded on a wooden bench</div>
      <div class="field"><small>Alt text, Norwegian</small>Et rødt ullpledd brettet på en trebenk</div>
      <div class="button">Publish for review</div>
    </div>
  </div>
  <div class="arc"></div><div class="deck"></div>`,
  `body { background: #0E161C; color: #F3F5F2; }
   .card { position: absolute; inset: 0; padding: 96px 112px; display: flex; flex-direction: column; justify-content: space-between; }
   .brand { display: flex; align-items: center; gap: 22px; font-size: 52px; font-weight: 600; }
   .text { max-width: 1060px; }
   h1 { margin: 0 0 28px; font-size: 92px; line-height: 1.02; font-weight: 600; font-stretch: 112%; letter-spacing: -0.02em; }
   p { margin: 0; font-size: 34px; line-height: 1.4; color: #B7C3CC; max-width: 26em; }
   .window { position: absolute; right: 112px; top: 96px; width: 520px; padding: 22px 26px 28px; border-radius: 18px; background: #F3F5F2; color: #13232F; box-shadow: 0 30px 80px rgba(0,0,0,.45); font-size: 22px; }
   .bar { display: flex; gap: 8px; margin-bottom: 22px; } .bar span { width: 12px; height: 12px; border-radius: 50%; background: #CBD3D9; }
   .row { display: flex; justify-content: space-between; align-items: baseline; font-size: 26px; margin-bottom: 18px; } .row em { font-style: normal; color: #6A7A86; font-size: 20px; }
   .field { border: 1.5px solid #D6DDE2; border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; line-height: 1.3; } .field small { display: block; font-size: 15px; color: #6A7A86; margin-bottom: 4px; }
   .button { margin-top: 18px; background: #13232F; color: #fff; text-align: center; border-radius: 10px; padding: 14px; font-weight: 600; }
   .arc { position: absolute; right: 112px; bottom: 96px; width: 520px; height: 260px; border: 24px solid #B0802A; border-bottom: 0; border-radius: 520px 520px 0 0; box-sizing: border-box; opacity: .95; }
   .deck { position: absolute; right: 60px; bottom: 84px; width: 640px; height: 24px; border-radius: 12px; background: #F3F5F2; }`);
