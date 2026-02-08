#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const outDir = path.join(__dirname, "..", "out");
const vsixPath = path.join(__dirname, "..", "budget-master-0.0.1.vsix");
let debounceTimer = null;
const DEBOUNCE_MS = 1500;

function install() {
  try {
    console.log("[watch-and-install] Packaging and installing...");
    execSync("npx vsce package --allow-missing-repository", {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
    });
    const tmpVsix = "/tmp/budget-master-0.0.1.vsix";
    fs.copyFileSync(vsixPath, tmpVsix);
    execSync(`cursor --install-extension ${tmpVsix}`, {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
    });
    console.log("[watch-and-install] Done. Reload Cursor window (Cmd+Shift+P → \"Developer: Reload Window\") to see changes.");
  } catch (e) {
    console.error("[watch-and-install] Error:", e.message);
  }
}

function scheduleInstall() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    install();
  }, DEBOUNCE_MS);
}

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

console.log("[watch-and-install] Watching out/ for changes. Edit src/*.ts and save; then reload Cursor to see updates.");
fs.watch(outDir, { recursive: true }, (event, filename) => {
  if (filename && (filename.endsWith(".js") || filename.endsWith(".js.map"))) {
    scheduleInstall();
  }
});
