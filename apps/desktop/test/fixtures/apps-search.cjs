const { app, BrowserWindow } = require("electron");

// Runs in the renderer, with no Node access.
async function searchScenario() {
  const until = async (f) => {
    const end = Date.now() + 5000;
    while (!f()) {
      if (Date.now() > end) throw new Error("UI test timed out");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
  const names = () =>
    [...document.querySelectorAll("div.truncate.font-medium")]
      .map((e) => e.textContent)
      .filter((t) => t === "Gmail" || t === "GitHub");
  const fill = async (value) => {
    const input = document.querySelector("input[type=search]");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
  };
  await until(() => window.searchTest?.pending() === 1);
  await fill("github");
  const immediate = names();
  await until(() => window.searchTest.pending() === 2);
  window.searchTest.answer(1, true);
  await tick();
  const newer = names();
  window.searchTest.answer(0, false);
  await tick();
  const late = names();
  const storedAfterLate = window.searchTest.stored();
  window.searchTest.event();
  await tick();
  const event = names();
  await fill("");
  await until(() => window.searchTest.pending() === 3);
  window.searchTest.answer(2, false);
  await tick();
  const cleared = names();
  await fill("code_host");
  const slugOnly = names();
  await fill("no-such-app");
  const noMatch = names();
  return { immediate, newer, late, storedAfterLate, event, cleared, slugOnly, noMatch };
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  try {
    await win.loadFile(process.argv[2]);
    const result = await win.webContents.executeJavaScript(`(${searchScenario.toString()})()`);
    console.log(`SEARCH_RESULT ${JSON.stringify(result)}`);
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
