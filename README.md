# Unity Launcher

A Minecraft launcher built with Electron, React and TypeScript. It browses Modrinth and CurseForge as one list, manages instances, and builds item skins into resource packs.

## Running it

- **From source:** `npm install`, then `npm run electron:dev`.
- **As an installed Mac app:** `npm run app:install` builds it and puts it in Applications. Run the same command after making changes to update it. The app has no Apple developer signature, so it works on the Mac that built it but would need signing to share.

## Cloud backups

Backups go to OneDrive if it's installed and signed in. To use somewhere else, choose any folder your cloud service syncs (iCloud Drive, Dropbox, Google Drive, or a USB stick) in Settings. **Back up to cloud** on an instance saves its mods, configs and saves there, and Library > Import Instance > Import Cloud restores them on another device. The latest backup and the one before it are kept.

## API keys and sign-in

No keys or tokens are stored in this repository.

- **CurseForge:** get a key at <https://console.curseforge.com> and paste it into Settings > API keys. It is encrypted with Electron's `safeStorage` (Keychain, DPAPI or the Linux keyring) and never sent to the page. Modrinth needs no key.
- **Web preview (`npm run web`):** this runs outside Electron, so it has no keychain. Copy `.env.example` to `.env.local` and set the key there. Git ignores that file.
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
