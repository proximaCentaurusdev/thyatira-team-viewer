// Exposes the smallest possible surface to index.html: one function,
// setVideoProtection(bool), that forwards to the main process over IPC.
// contextIsolation is on and nodeIntegration is off in main.js, so the
// page never gets direct access to Node/Electron internals — only this
// one function, via window.electronAPI.
//
// In a normal browser (Chrome, Edge, Safari, mobile, etc.) this file never
// runs, so window.electronAPI is simply undefined there — exactly what
// index.html already checks for before calling it.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  /**
   * @param {boolean} enabled
   * @returns {Promise<boolean>} whether the main process applied the
   *   change successfully (see the long comment in main.js for what this
   *   can and can't confirm about which Windows affinity flag resulted).
   */
  setVideoProtection: (enabled) =>
    ipcRenderer.invoke("video-protection:set", Boolean(enabled)),
});
