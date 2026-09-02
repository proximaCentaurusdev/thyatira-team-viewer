# Thyatira Team — Optional Electron Protected Wrapper

This is **not** a rebuild of the website. `index.html` stays exactly what
it is — a normal site that works in any browser. This folder is a thin,
optional wrapper: an Electron window that loads that same `index.html`
and adds one native capability a browser tab cannot grant itself —
Windows-level content protection — turned on only while a video is
actually playing.

## Expected repository layout

```
/                      <- your repo root
├── index.html
├── [other site files: dashboard.html, manifest.json, images, etc.]
│
└── electron/          <- this folder
    ├── main.js
    ├── preload.js
    ├── package.json
    └── README.md
```

`main.js` always locates `index.html` as `../index.html`, computed from
its own folder (`__dirname`) — never as an absolute or hardcoded path. As
long as `electron/` sits directly inside the same repository as
`index.html`, this works after cloning/downloading to **any** folder, on
**any** Windows computer, under any username or drive letter.

## What this is / is not

| | |
|---|---|
| **Is** | A `BrowserWindow` pointed at your existing site, plus a 2-line IPC bridge |
| **Is not** | A desktop rewrite of the UI. No screens, styles, or components are reimplemented here. |
| **Runs** | `index.html`'s own JS unmodified — same Firestore auth, same session/access-code logic, same watermark, same Protected Video Mode, same capture-key deterrence already in the site |
| **Adds** | `win.setContentProtection(true/false)`, toggled by the page itself at the exact moments Protected Video Mode starts/stops |

The website must keep working identically with this wrapper deleted
entirely — nothing in `index.html`'s core behavior depends on
`window.electronAPI` existing; it's checked with a plain `if` and is a
no-op everywhere else (Chrome, Edge, Safari, mobile browsers, etc.).
**No changes to `index.html` are required or included** — the bridge
hooks (`setElectronVideoProtection`, `updateProtectionBadge`, and the
calls to them from the PLAYING/PAUSED/ENDED/CUED player states and from
`closeVideo()`) already exist in `index.html`, in the section commented
`ELECTRON BRIDGE (optional)`, and already call
`window.electronAPI.setVideoProtection(enabled)` — which is exactly the
function this `preload.js` exposes. This package was written to match
that existing code, not the other way around.

## Setup

```bash
cd electron
npm install
npm start                 # loads ../index.html locally
```

To point the wrapper at a deployed site instead of the local file:

```bash
# macOS / Linux
THYATIRA_URL=https://your-deployed-site.example.com npm start

# Windows (cmd.exe)
set THYATIRA_URL=https://your-deployed-site.example.com && npm start

# Windows (PowerShell)
$env:THYATIRA_URL="https://your-deployed-site.example.com"; npm start

# Cross-platform, no manual export needed:
npm run start:remote
```

## Building a distributable Windows installer (optional)

```bash
npm run dist:win
```

By default, `electron-builder`'s `files` list only packages the files
inside this `electron/` folder (`main.js`, `preload.js`, `package.json`)
— it deliberately does **not** try to bundle `../index.html` into the
installer, because electron-builder does not reliably support packaging
files from outside the folder that contains `package.json`.

This means an installer built with `npm run dist:win` as-is will only
work if `THYATIRA_URL` is set (baked in via `start:remote`-style env var,
or hardcoded temporarily in `main.js` for that build) to point at your
**deployed** site. That is the supported, recommended path for
distributing a built `.exe` to end users. If you specifically need the
installer to carry a local copy of the website's files, add an
`extraResources` entry to the `build` config in `package.json` that
copies your site folder in, and update `main.js`'s `resolveStartUrl()`
to read from `process.resourcesPath` when `app.isPackaged` is true — this
is an intentional extra step so a first-time install doesn't accidentally
ship a stale copy of the site instead of the live one.

## How the toggle works

1. `index.html` already tracks `protectedModeActive` — true exactly while
   a video is in the `PLAYING` state (see `onPlayerStateChange` in the
   site's own JS).
2. Hooks already present at the PLAYING / PAUSED / ENDED / CUED
   transitions, plus `closeVideo()` as a safety net, each call
   `window.electronAPI.setVideoProtection(true|false)` if that API exists.
3. `preload.js` forwards that call over IPC (`video-protection:set`) to
   `main.js`.
4. `main.js` calls `win.setContentProtection(enabled)` and reports back
   whether the call succeeded (not *which* Windows capture-affinity flag
   Electron applied internally — see below for why that distinction
   matters and why this can't confirm it).
5. The page shows a small "Windows Content Protection Active" badge in
   the video top bar **only** when running inside Electron with
   protection currently on — a normal browser tab never shows this,
   because it would be false to claim.

Protection is never on by default and never left on when nothing is
playing — it starts `false` in `createWindow()`, turns on only on
`PLAYING`, and turns off on `PAUSED`, `ENDED`, or the viewer closing.

## What Windows content protection actually does — and doesn't

`win.setContentProtection(true)` calls `SetWindowDisplayAffinity` on
Windows under the hood. Depending on your Electron version and the
Windows build the user is running, that resolves to one of two flags:

- **`WDA_EXCLUDEFROMCAPTURE`** (Windows 10 version 2004+, and only on
  Electron versions that request it) — the window is excluded from most
  screen-capture APIs: Win32 GDI capture, most third-party screen
  recorders, most "share your screen" features in conferencing apps.
- **`WDA_MONITOR`** (older Windows, or older Electron behavior) — a
  weaker, legacy flag that does **not** exclude the window from capture
  the same way; it exists mainly for compatibility.

Electron decides internally which one applies and does not report that
choice back to the renderer, so `index.html`'s badge intentionally says
only "Content Protection Active" — it does not claim a specific
guarantee level it can't verify. **Check your installed Electron
version's release notes against the target Windows build** if you need
to know for certain which flag your users are getting.

**What this can never do, on any Electron/Windows combination:**

- Stop a phone or camera pointed at the screen.
- Stop capture on macOS/Linux (this feature is Windows-specific;
  `setContentProtection` is close to a no-op for capture-blocking
  purposes on other OSes, though it does still run without erroring).
- Provide real DRM. This is not Widevine/PlayReady-level protection —
  there is no encrypted, licensed video pipeline here. It is a native
  window-visibility flag, nothing more.
- Guarantee protection on every Windows machine — older Windows builds,
  certain GPU drivers, or remote-desktop/virtual-machine environments can
  all reduce or bypass the effect.

**What it's honestly good for:** blocking the common, casual
capture paths (screenshot tools, OBS/most recorders, most screen-share)
on a reasonably current Windows 10/11 machine — genuinely stronger than
anything a browser tab alone can offer, but a deterrent layered on top of
the site's existing watermark and Protected Video Mode, not a replacement
guarantee.

## Security notes

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` are
  all set in `main.js` — the renderer never gets direct Node/Electron
  access.
- `preload.js` exposes exactly one function, `window.electronAPI.setVideoProtection(enabled)`,
  via `contextBridge`. Nothing else is exposed — no `require`, no
  filesystem access, no arbitrary IPC channel.
- No remote code execution, no `webSecurity: false`, no changes to
  navigation or permission handling beyond loading the start URL.

## Troubleshooting

- **"Could not find index.html" error on `npm start`** — this means
  `electron/` isn't sitting directly inside the same folder as
  `index.html`. Check your repo layout matches the diagram at the top of
  this file.
- **Blank white window** — usually means the site failed to load; check
  the terminal running `npm start` for a "Failed to load" message, or
  open Electron's DevTools (`Ctrl+Shift+I`) to see the renderer console.
- **`window.electronAPI` is `undefined` in the app** — `preload.js` isn't
  loading. Confirm `electron/preload.js` exists and that `main.js`'s
  `webPreferences.preload` path is unchanged.

## Files

```
electron/
  main.js       BrowserWindow + the single IPC handler
  preload.js    contextBridge — exposes window.electronAPI.setVideoProtection only
  package.json  npm scripts + electron-builder config for a Windows installer
  README.md     this file
index.html       UNCHANGED — the Electron bridge hooks already live in its own
                  <script> (search for "ELECTRON BRIDGE" to see all of them)
```
