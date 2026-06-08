# Releasing

Distributable installers are built and published by GitHub Actions
(`.github/workflows/release.yml`). Releases live at
**https://github.com/Webeleon/sight-reading-practice/releases** — the same slug
the landing page links to (`landing/lib/releases.ts`).

## Cut a release

1. **Bump the version** in `package.json` (e.g. `0.1.0` → `0.2.0`).
2. **Commit** it on `main`.
3. **Tag and push** a matching `v` tag:
   ```bash
   git tag v0.2.0     # must equal package.json version — the workflow asserts this
   git push origin main --tags
   ```

The push triggers the workflow:

- **`test`** — `npm ci && npm run verify` (unit + property + typecheck + purity gate).
- **`build`** (matrix) — on macOS, Windows, and Linux runners: `npm run build`
  then `electron-builder`. macOS produces **arm64 + Intel** `.dmg`/`.zip` from one
  runner (no native modules → no per-arch rebuild). Each runner uploads its
  installers as a workflow artifact.
- **`release`** — collects every runner's installers and publishes a single
  **GitHub Release** for the tag, with the install instructions below as the body.

> **Dry run (no release):** trigger the workflow manually from the **Actions** tab
> (`workflow_dispatch`). It runs `test` + `build` and uploads artifacts but skips
> the `release` job (that job is gated on a `v*` tag push).

## Build locally

```bash
npm run package:mac     # .dmg + .zip (arm64 + x64) into release/
npm run package:win     # NSIS .exe   (run on Windows)
npm run package:linux   # AppImage + .deb (run on Linux)
npm run package         # current OS only
```

Output lands in `release/` (gitignored). To smoke-test the real packaged binary:
`open "release/mac-arm64/Sight Reading.app"` — confirm the window opens and the
log shows `[DB] persistence ready` (migrations resolved from the packaged path).

## Installing the (currently unsigned) builds

These builds are **not code-signed yet** (Apple notarization is deferred). One-time
steps for testers:

- **macOS** (`.dmg`): drag to Applications, then right-click the app → **Open** →
  **Open**. If you see "app is damaged", run:
  `xattr -cr "/Applications/Sight Reading.app"`.
- **Windows** (`-setup.exe`): SmartScreen → **More info** → **Run anyway**.
- **Linux**: `chmod +x` the `.AppImage` and run it, or `sudo dpkg -i` the `.deb`.

## Notes / future work

- **Code signing** — deferred. macOS notarization needs a paid Apple Developer
  account; provide certs/credentials as GitHub secrets (`CSC_LINK`,
  `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`),
  set `mac.identity` accordingly, and add an `afterSign` notarize step.
- **Auto-update** — out of scope. Would mean switching the `release` job back to
  electron-builder's GitHub publisher so it emits `latest*.yml`, plus wiring
  `electron-updater` in the app.
- **App icon** — none yet; the default Electron icon is used. Drop
  `icon.icns`/`icon.ico`/`icon.png` into `build/` to brand it.
