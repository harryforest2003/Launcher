# Model editor

The model and skin editor Unity Launcher opens inside its own window. It's built from the code in this folder by `npm run blockbench:build`, and packed into the app.

## Credit

This is [Blockbench](https://www.blockbench.net) 5.2.2, by JannisX11 and the Blockbench contributors, from <https://github.com/JannisX11/blockbench/tree/v5.2.2>. Blockbench is free software under the GNU General Public License, version 3 or later: see [LICENSE.MD](LICENSE.MD). This folder, and Unity Launcher with it, is under the same licence.

## Changes for Unity Launcher

- **The start screen is taken out.** The launcher opens each model or skin straight into the editor, so the start page, its news feed and pictures, the home button and the backup and streamer-mode notices it showed are gone. `showEditor()` in `js/io/project.ts` replaces `setStartScreen()`.
- **The "download the app" button and install-as-app files are taken out**, since it runs inside an app.
- **Parts only the desktop version used are left out:** its Electron app (`electron/`, `js/desktop.ts`, `js/native_apis.ts`), installer pictures and icons, release scripts, plugin type definitions and Blockbench's own GitHub setup. The web build uses `js/web.ts` and `js/native_apis_web.ts` in their place.

The launcher's side, which hands the editor what to open and takes back what Save makes, is in `electron/blockbench/`. It also hides the editor's project tabs, as only one thing is open at a time.

## Changing it

Edit anything here, then run `npm run blockbench:build` (or `npm run app:install`, which builds it when it's missing) to see the change in the app.
