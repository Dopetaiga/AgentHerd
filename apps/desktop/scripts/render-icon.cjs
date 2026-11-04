// Renders resources/icon.svg to resources/icon.png (1024 px) with Electron:
//   unset ELECTRON_RUN_AS_NODE; ./node_modules/.bin/electron scripts/render-icon.cjs resources/icon.svg resources/icon.png
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const [svg, out] = process.argv.slice(-2);
app.dock?.hide();
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  w.webContents.setZoomFactor(1);
  const html = `<html><body style="margin:0;background:transparent">${fs.readFileSync(svg, "utf8")}</body></html>`;
  await w.loadURL("data:text/html;base64," + Buffer.from(html).toString("base64"));
  await new Promise((r) => setTimeout(r, 500));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(out, img.resize({ width: 1024, height: 1024 }).toPNG());
  app.quit();
});
