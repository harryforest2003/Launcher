# Unity Launcher

A Minecraft launcher built with Electron, React and TypeScript. It browses Modrinth and CurseForge as one list, manages instances, and builds item skins into resource packs.

## Running it

- **From source:** `npm install`, then `npm run electron:dev`.
- **As an installed Mac app:** `npm run app:install` builds it and puts it in Applications. Run the same command after making changes to update it. The first time, it also builds the copy of Blockbench the launcher opens, from Blockbench's official source.

## Getting it on a new Mac

Everything the app is built from is in this repository, so a new Mac needs only this repository and GitHub.

**Download a build from GitHub**

1. On GitHub, open **Actions**, then **Build Mac app**, then **Run workflow**. It builds the app for Apple Silicon and Intel Macs, which takes about 5 minutes.
2. Open **Releases** and download the zip for your Mac: `apple-silicon` for an M1 chip or later, `intel` otherwise. (Apple menu > About This Mac says which.)
3. Unzip it and drag **Unity Launcher** into Applications.
4. The app has no Apple developer signature, so the first time macOS won't open it. Open System Settings > Privacy & Security and click **Open Anyway**, or run `xattr -dr com.apple.quarantine "/Applications/Unity Launcher.app"` in Terminal.

Run the workflow again after changing the code to get an updated build. Each run uses GitHub's Mac build minutes, which are limited each month on a free account.

**Build it on the Mac**

1. Install git with `xcode-select --install`, and Node.js 26 or later from <https://nodejs.org>.
2. `git clone https://github.com/harryforest2003/Launcher.git`, then `cd Launcher`.
3. `npm ci`, then `npm run app:install`.

**What isn't in the repository**

- Your instances, worlds and mods are on the Mac. Back them up with **Back up to cloud** (below) and restore them with Library > Import Instance > Import Cloud.
- Personal API tokens (Modrinth, Nexus Mods, GitHub) and your Microsoft sign-in are kept encrypted on each Mac. Add them again in Settings, and sign in again.
- CurseForge's key is kept by the launcher's proxy on Cloudflare, not here. [proxy/curseforge/README.md](proxy/curseforge/README.md) says how to change it.

## Cloud backups

Backups go to OneDrive if it's installed and signed in. To use somewhere else, choose any folder your cloud service syncs (iCloud Drive, Dropbox, Google Drive, or a USB stick) in Settings. **Back up to cloud** on an instance saves its mods, configs and saves there, and Library > Import Instance > Import Cloud restores them on another device. The latest backup and the one before it are kept.

## API keys and sign-in

No keys or tokens are stored in this repository.

- **CurseForge:** the launcher asks its proxy, a Cloudflare Worker in [proxy/curseforge](proxy/curseforge), which holds the key. So the app carries no key.
- **Personal API tokens:** Modrinth, Nexus Mods and GitHub tokens belong to each player and go in Settings > Personal API tokens. They're encrypted with Electron's `safeStorage` (Keychain, DPAPI or the Linux keyring) and never sent to the page.
- **Web preview (`npm run web`):** this runs outside Electron, so it has no keychain. To use CurseForge there, copy `.env.example` to `.env.local` and set a key. Git ignores that file.
- **Microsoft sign-in:** `electron/auth/config.cjs` holds the app's Azure client ID, which is public rather than secret. Mojang has to approve each Azure app for Minecraft sign-in, at <https://aka.ms/mce-reviewappid>. Sign-in tokens are encrypted the same way as API keys.

## Licence

GPL-3.0. See [LICENSE](LICENSE).

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
