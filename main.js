// Thyatira Team — optional Electron protected wrapper
// --------------------------------------------------------------------------
// This process does ONE job: open a normal BrowserWindow pointed at the
// SAME index.html the browser serves, and toggle Windows-level content
// protection on/off in response to a single IPC call from that page.
//
// It does not reimplement any UI, does not intercept Firestore calls, and
// does not touch the video player. All of that stays exactly as it is in
// index.html — this file only adds native window-level protection that a
// browser tab has no API to request for itself.

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

// Expected repository layout:
//
//   /                        <- your site's repo root
//   ├── index.html
//   ├── [other site files]
//   └── electron/            <- this folder (main.js lives here)
//
// __dirname always resolves to the "electron" folder itself, regardless of
// where the repo is cloned/downloaded to (any drive letter, any username,
// any path with spaces) — so this never needs an absolute or hardcoded path.
const SITE_ROOT = path.join(__dirname, "..");
const LOCAL_INDEX_PATH = path.join(SITE_ROOT, "index.html");

// Point this at your deployed site for production use (works on Windows,
// macOS, and Linux without any path juggling). Falls back to the local
// index.html one directory up from /electron for development/testing, so
// this wrapper works out of the box before you've deployed anywhere.
//
// IMPORTANT (Windows fix): the local fallback is built with Node's
// pathToFileURL() rather than a hand-built `file://${path}` string.
// Windows paths use backslashes and a "C:" drive prefix — concatenating
// those directly into a "file://" string produces an invalid/unreliable
// URL on Windows (backslashes aren't valid URL path separators and the
// drive colon isn't escaped). pathToFileURL() builds a correct,
// cross-platform file URL every time.
function resolveStartUrl() {
  if (process.env.THYATIRA_URL) {
    return process.env.THYATIRA_URL;
  }
  if (!fs.existsSync(LOCAL_INDEX_PATH)) {
    throw new Error(
      "Could not find index.html at: " +
        LOCAL_INDEX_PATH +
        '\nExpected repository layout is:\n' +
        '  /index.html\n' +
        '  /electron/main.js  <-- this file\n' +
        "Make sure this 'electron' folder sits directly inside the same " +
        "repository as index.html, one level below the site root."
    );
  }
  return pathToFileURL(LOCAL_INDEX_PATH).toString();
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#020100", // matches --deep-black, avoids a white flash while the page loads
    title: "Thyatira Team",
    autoHideMenuBar: true, // this is a website wrapper, not a desktop app shell — no native menu bar needed
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // No changes to how the page itself behaves — this wrapper does not
      // disable web security, does not inject scripts beyond preload.js,
      // and does not modify navigation. It is a plain, unmodified browser
      // surface for index.html, with one extra native capability exposed
      // via contextBridge (see preload.js).
    },
  });

  // Content protection starts OFF. It is only ever turned on in direct
  // response to the page telling us Protected Video Mode has begun (see
  // the ipcMain.handle block below) — never on by default, never left on
  // when nothing is playing.
  win.setContentProtection(false);

  let startUrl;
  try {
    startUrl = resolveStartUrl();
  } catch (err) {
    console.error(err.message);
    app.quit();
    return;
  }

  win.loadURL(startUrl);
  win.once("ready-to-show", () => win.show());

  win.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error(
        "Failed to load",
        validatedURL,
        "-",
        errorCode,
        errorDescription
      );
    }
  );

  win.on("closed", () => {
    win = null;
  });
}

/**
 * Single IPC entry point, called from preload.js's exposed
 * `setVideoProtection(enabled)`. Mirrors exactly what the site's existing
 * Protected Video Mode hooks in index.html already call:
 *   - enable win.setContentProtection(true) while a video is PLAYING
 *   - disable it the instant the video pauses, ends, or the viewer closes
 *
 * IMPORTANT, stated plainly and matching what's in the README: Electron's
 * setContentProtection(true) calls SetWindowDisplayAffinity on Windows.
 * Which specific affinity flag gets applied (the strong WDA_EXCLUDEFROMCAPTURE,
 * vs. the older/weaker WDA_MONITOR) is decided internally by Electron
 * based on the Electron version and the Windows build it's running on —
 * this file does not call SetWindowDisplayAffinity directly, and Electron
 * does not expose which one was used back to JS. Check your Electron
 * version's release notes against your target Windows build if you need
 * to confirm which flag applies; the README lists what each one actually
 * does and does not protect against. This function can only confirm
 * *that* the call was made and did not throw — not which affinity level
 * resulted.
 */
ipcMain.handle("video-protection:set", (_event, enabled) => {
  if (!win || win.isDestroyed()) return false;
  try {
    win.setContentProtection(Boolean(enabled));
    return true;
  } catch (err) {
    console.error("setContentProtection failed:", err);
    return false;
  }
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
