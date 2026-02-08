# Release checklist (vsce & Marketplace)

Use this before publishing or updating the extension (e.g. `budget-master-*.vsix` and VS Code Marketplace).

## Pre-publish

- [ ] **Version** — Bump `version` in `package.json` (e.g. `0.0.1` → `0.0.2`). Use [semver](https://semver.org/): major for breaking changes, minor for new features, patch for fixes.
- [ ] **Changelog** — Note new features/fixes (e.g. in README or a CHANGELOG.md) so Marketplace “What’s New” is accurate.
- [ ] **README** — Features, install steps, and config are up to date.
- [ ] **Build** — `npm run compile` (or `npm run package`) succeeds with no errors.
- [ ] **Lint** — `npm run lint` passes.

## Packaging (vsce)

- [ ] **Install vsce** — `npm i -g @vscode/vsce` (or use `npx vsce`).
- [ ] **Package** — `npm run package` (runs compile then `vsce package`). Produces `budget-master-<version>.vsix`.
- [ ] **Smoke test** — Install the `.vsix` in Cursor/VS Code (Extensions → “…” → Install from VSIX), reload, open Budget Master, send a chat, check cost/settings.
- [ ] **.vscodeignore** — Unnecessary files (e.g. tests, dev scripts, `*.vsix`) are ignored so they’re not shipped.

## Marketplace (first time)

- [ ] **Publisher** — Create/login at [marketplace.visualstudio.com](https://marketplace.visualstudio.com/) and create a publisher if needed.
- [ ] **package.json** — `publisher` is set (replace `"local"` with your publisher id for Marketplace).
- [ ] **Icon** — Add an icon (e.g. 128x128) and reference in `package.json` under `contributes` if required.
- [ ] **Screenshots / gallery** — Optional but recommended: 1–2 screenshots and short description for the Marketplace listing.
- [ ] **Categories & keywords** — `categories` and keywords in package.json are set (e.g. "AI", "Other").
- [ ] **License** — Repo or package includes a LICENSE file; Marketplace may require it.

## Publish / update

- [ ] **Login** — `vsce login <publisher-id>` (one-time).
- [ ] **Publish** — `vsce publish` (bumps from package.json) or `vsce publish <version>`.
- [ ] **Post-publish** — Verify the extension page and install from Marketplace in a clean profile.

## Local install only (no Marketplace)

- [ ] Run `npm run package` to build the `.vsix`.
- [ ] Use **Install from VSIX** in Cursor/VS Code and point to `budget-master-<version>.vsix`.
- [ ] Or use `npm run install:local` if configured to copy the vsix and install into Cursor.

---

**One-liner for a quick local release:**  
`npm run compile && npm run package` then install the generated `.vsix` via the editor.
