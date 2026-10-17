// icon.js — draws the app icon and the menu-bar image:
//   assets/icon.png (1024), assets/icon.icns, assets/trayTemplate.png + @2x
//   npm run icons
const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const out = path.join(__dirname, '..', 'assets');

// A cloud made of four circles on a flat base; (x, y) is its centre, w its width.
const CLOUD = `function cloud(c, x, y, w) {
  const u = w / 10;
  c.beginPath();
  c.arc(x - 2.6 * u, y + 0.6 * u, 2.1 * u, 0, Math.PI * 2);
  c.arc(x - 0.4 * u, y - 1.2 * u, 3.0 * u, 0, Math.PI * 2);
  c.arc(x + 2.5 * u, y - 0.1 * u, 2.4 * u, 0, Math.PI * 2);
  c.moveTo(x - 2.6 * u, y + 2.7 * u);
  c.roundRect(x - 4.7 * u, y + 0.2 * u, 9.6 * u, 2.5 * u, 1.25 * u);
  c.fill();
}`;

// The icon: a Big Sur rounded square in sky blue → deep indigo, a white cloud, an AI sparkle.
const ICON = `<style>body{margin:0;background:transparent}canvas{display:block;width:1024px;height:1024px}</style>
<canvas id=c width=1024 height=1024></canvas><script>
${CLOUD}
const c = document.getElementById('c').getContext('2d');
const g = c.createLinearGradient(0, 100, 0, 924);
g.addColorStop(0, '#38bdf8'); g.addColorStop(0.55, '#2563eb'); g.addColorStop(1, '#3730a3');
c.shadowColor = 'rgba(0,0,0,.28)'; c.shadowBlur = 28; c.shadowOffsetY = 12;
c.beginPath(); c.roundRect(100, 100, 824, 824, 186); c.fillStyle = g; c.fill();
c.shadowColor = 'transparent';
// soft light from the top
const gl = c.createRadialGradient(512, 160, 40, 512, 160, 620);
gl.addColorStop(0, 'rgba(255,255,255,.30)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
c.beginPath(); c.roundRect(100, 100, 824, 824, 186); c.fillStyle = gl; c.fill();
// cloud with a faint shadow underneath
c.shadowColor = 'rgba(20,30,90,.35)'; c.shadowBlur = 40; c.shadowOffsetY = 18;
c.fillStyle = '#ffffff'; cloud(c, 500, 545, 560);
c.shadowColor = 'transparent';
// sparkle, top right
function star(x, y, r) {
  c.beginPath();
  c.moveTo(x, y - r);
  c.quadraticCurveTo(x + r * .16, y - r * .16, x + r, y);
  c.quadraticCurveTo(x + r * .16, y + r * .16, x, y + r);
  c.quadraticCurveTo(x - r * .16, y + r * .16, x - r, y);
  c.quadraticCurveTo(x - r * .16, y - r * .16, x, y - r);
  c.fill();
}
c.fillStyle = '#fde68a'; star(728, 300, 86);
c.fillStyle = '#ffffff'; star(812, 420, 38);
</script>`;

// The menu-bar image: a solid cloud (macOS tints template images for light and dark bars).
const TRAY = (px) => `<style>body{margin:0;background:transparent}canvas{display:block}</style>
<canvas id=c width=${px} height=${px}></canvas><script>
${CLOUD}
const c = document.getElementById('c').getContext('2d');
c.scale(${px} / 18, ${px} / 18);
c.fillStyle = '#000'; cloud(c, 9, 9.6, 16.4);
</script>`;

async function render(html, px) {
  const win = new BrowserWindow({ width: px, height: px, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const img = (await win.webContents.capturePage()).resize({ width: px, height: px, quality: 'best' });
  win.destroy();
  return img;
}

app.on('window-all-closed', () => {}); // each render closes its window; don't quit between them
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const big = await render(ICON, 1024);
  fs.writeFileSync(path.join(out, 'icon.png'), big.toPNG());

  const set = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-icon-')), 'icon.iconset');
  fs.mkdirSync(set);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const k of [1, 2]) {
      const px = size * k;
      fs.writeFileSync(path.join(set, `icon_${size}x${size}${k > 1 ? '@2x' : ''}.png`), big.resize({ width: px, height: px, quality: 'best' }).toPNG());
    }
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(out, 'icon.icns')]);

  // Tiny windows don't load, so the menu-bar cloud is drawn large and shrunk.
  const tray = await render(TRAY(360), 360);
  fs.writeFileSync(path.join(out, 'trayTemplate.png'), tray.resize({ width: 18, height: 18, quality: 'best' }).toPNG());
  fs.writeFileSync(path.join(out, 'trayTemplate@2x.png'), tray.resize({ width: 36, height: 36, quality: 'best' }).toPNG());
  console.log('wrote', fs.readdirSync(out).join(', '));
  app.quit();
});
