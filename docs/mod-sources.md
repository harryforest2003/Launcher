# Mod sources beyond Nexus Mods and CurseForge

Researched 2026-11-18 against each source's current docs and, where it was safe and light, one or two
test requests (User-Agent `UnityLauncher/1.0 (game mod manager)`). Counts are rough and taken on that
date. "Tested" means a live request confirmed the behaviour; everything else comes from the linked docs.

How keys should be handled in the launcher (the rule the owner set):

- **No key needed:** just add the source.
- **Personal key** (each player has their own, tied to their account): an optional field in Settings,
  stored like the Nexus key in `electron/secrets.cjs` (`personal: true`). The source stays off, or
  limited, until the player adds one.
- **Launcher key** (one key for the app, like CurseForge's): route it through the Cloudflare Worker in
  `proxy/`, the same way as CurseForge, so no key ships in the app. A key set on the computer wins.

## Shortlist: what to add first

Ranked on the games the launcher supports times how easy the source is to use.

| # | Source | Why | Key | Downloads |
|---|---|---|---|---|
| 1 | **Thunderstore** | 376 games, 132k packages. Owns Lethal Company (55k) and Valheim (16k), and has Cities: Skylines II. Ships install rules per game. | None | Direct, no login |
| 2 | **Steam Workshop** | The main or only mod source for RimWorld, Cities: Skylines and thousands of other games. | Free Steam Web API key for search; details need none | Through the Steam client (subscribe), or SteamCMD with an account that owns the game |
| 3 | **mod.io** | Baldur's Gate 3's official in-game mod source, plus SnowRunner, Deep Rock Galactic, BONELAB, Mordhau and others. | Free personal key, read-only | Direct, from the API |
| 4 | **GameBanana** | 571k mods across thousands of games (Celeste, Friday Night Funkin', Sonic, Persona, Counter-Strike). Thin for the launcher's big games, but broad. | None | Direct, with MD5 |
| 5 | **Factorio Mod Portal** | Every Factorio mod (25k), official, with SHA-1 and dependencies. | None to browse; player's own username and token to download | Direct with the token, which the game already saves locally |

Next after those: **BeatMods** (Beat Saber, keyless, direct, version-matched), **SpaceDock + CKAN**
(Kerbal Space Program, keyless, hashes and dependencies), and **GitHub releases** (update checks for
mods that publish there; the launcher already has a GitHub token slot).

No public API at all: ModDB, The Sims Resource, GTA5-Mods, Overtake (RaceDepartment), Bethesda.net
Creations, Paradox Mods. Details below.

---

## Thunderstore

- **Games:** 376 communities, 132,080 packages (tested). Biggest: Lethal Company 54,963, Valheim 15,862,
  Risk of Rain 2 8,476, R.E.P.O. 7,755, H3VR 6,590, PEAK 2,940, BONELAB 1,624, Content Warning 1,382,
  Inscryption 742, Subnautica, Sons of the Forest, Cities: Skylines II (284), Hollow Knight: Silksong.
- **API:** REST/JSON. Base `https://thunderstore.io`. Swagger UI at
  [thunderstore.io/api/docs](https://thunderstore.io/api/docs/); schema at `/api/docs/?format=openapi`.
  - Community list: `GET /api/cyberstorm/community/` (tested).
  - Whole package list per game: `GET /c/{community}/api/v1/package/` (large), or the gzipped index
    `GET /c/{community}/api/v1/package-listing-index/` (302 to a CDN blob; this is what r2modman uses).
  - One package: `GET /api/experimental/package/{namespace}/{name}/` and `/{version}/`, plus `/readme/`
    and `/changelog/`.
  - Ecosystem schema: `GET /api/experimental/schema/dev/latest/` (tested). 390 games, each with Steam app
    IDs, exe names, mod loader (BepInEx, MelonLoader, etc.) and **install rules** (which folder each
    file type goes to). This is what r2modman and Gale use to support new games without code.
- **Key:** none for reading or downloading.
- **Downloads:** direct. `download_url` such as
  `https://thunderstore.io/package/download/{namespace}/{name}/{version}/` (tested).
- **Limits and terms:** no published rate limit or API terms. Listing responses carry
  `cache-control: max-age=30`. Open-source managers (r2modman, Gale) use it freely. Cache the listing
  index rather than paging the full list.
- **Metadata:** `dependencies` as `Namespace-Name-1.2.3` strings, `version_number`, `is_deprecated`,
  `date_updated`, ratings and downloads. Every package zip has a `manifest.json` with the same
  dependencies. Update checks: compare `latest.version_number`.

## Steam Workshop

- **Games:** thousands. For this launcher: RimWorld and Cities: Skylines (both mostly Workshop-only,
  tens of thousands and hundreds of thousands of items), Skyrim (original edition), Project Zomboid,
  Garry's Mod, Arma 3, Stellaris, Europa Universalis IV, Crusader Kings III, Hearts of Iron IV,
  Space Engineers, Wallpaper Engine.
- **API:** Steam Web API, REST/JSON. Base `https://api.steampowered.com`.
  - Search: `GET /IPublishedFileService/QueryFiles/v1/` with `appid`, `search_text`, `query_type`,
    `cursor`, `return_details`, `return_children` ([docs](https://partner.steamgames.com/doc/webapi/IPublishedFileService#QueryFiles)).
    **Needs a key** (tested: 403 without one).
  - Details: `POST /ISteamRemoteStorage/GetPublishedFileDetails/v1/` with `itemcount` and
    `publishedfileids[n]` ([docs](https://partner.steamgames.com/doc/webapi/ISteamRemoteStorage#GetPublishedFileDetails)).
    **No key** (tested).
  - Collections: `POST /ISteamRemoteStorage/GetCollectionDetails/v1/`, no key.
- **Key:** free Steam Web API key from [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)
  (needs a Steam account in good standing). The terms say the key is personal to the person and their
  application and must stay secret. A launcher key behind the Worker fits that; so does a player's own.
- **Downloads:** not over HTTP for most games. `file_url` is empty for current Workshop items (tested;
  only very old items fill it). Supported ways:
  1. Open `steam://url/CommunityFilePage/{id}` so the player subscribes; Steam downloads it to
     `steamapps/workshop/content/{appid}/{id}`, which the launcher can read.
  2. SteamCMD `workshop_download_item {appid} {id}`. Anonymous login works only for games that allow
     it (mostly ones with dedicated servers); otherwise it needs an account that owns the game.
- **Limits and terms:** 100,000 Web API calls a day per key; data shown "as is"; must not look endorsed
  by Valve ([API terms](https://steamcommunity.com/dev/apiterms)).
- **Metadata:** `time_updated` (update checks), `file_size`, tags (often game versions, as in RimWorld's
  `1.5`), `children` (required items), `hcontent_file`. No file hash or load order fields.

## mod.io

- **Games:** "more than 160" games in an older mod.io newsletter; more since. Baldur's Gate 3 (its
  in-game mod manager since Patch 7), SnowRunner, Deep Rock Galactic, Mordhau, BONELAB,
  Insurgency: Sandstorm, Ready or Not, Space Marine 2, Dying Light 2. mod.io publishes no total mod
  count; 2,700 new mods a day is its latest figure.
- **API:** REST/JSON, v1. Base per key: `https://u-{user-id}.modapi.io/v1` for a user key,
  `https://g-{game-id}.modapi.io/v1` for a game key (`https://api.mod.io/v1` still answers).
  `GET /games`, `GET /games/{game}/mods?_q=`, `GET /games/{game}/mods/{mod}/files`,
  `GET /games/{game}/mods/{mod}/dependencies` ([docs](https://docs.mod.io/restapi/introduction)).
- **Key:** required (tested: 401 without one). Any mod.io user gets a free read-only key at
  [mod.io/me/access](https://mod.io/me/access). Writing (subscribing, rating) needs an OAuth token
  (email code, Steam, Xbox or OpenID login). Game keys belong to game admins.
- **Downloads:** direct. Each file's `download.binary_url` works with the API key (it carries an expiry).
- **Limits and terms:** user key 60 requests a minute, OAuth token 120 a minute, 1,000 a minute per IP;
  game keys unlimited ([rate limits](https://docs.mod.io/restapi/rate-limiting)). Tools are covered by
  mod.io's API Access Terms ([mod.io/apiterms](https://mod.io/apiterms)) and players should accept
  mod.io's [Terms of Use](https://mod.io/legal/terms) before downloading.
- **Metadata:** `filehash.md5`, `filesize`, `version`, `changelog`, `virus_status`, `platforms`,
  dependencies endpoint, tags (often game versions), `date_updated` for update checks. A shared launcher
  key would hit 60 a minute across all players, so this should be a **personal key**.

## GameBanana

- **Games:** thousands; 571,146 mods in total (tested). Strongest for Celeste, Friday Night Funkin',
  Sonic, Persona, Street Fighter, Smash, Counter-Strike, Half-Life and Team Fortress 2. For the
  launcher's games it is thin (tested): Minecraft Java 948, Skyrim 103, GTA V 47, Fallout 4 30,
  The Sims 4 30, Lethal Company 21, Factorio 20, Cyberpunk 13, Stardew 10.
- **API:** REST/JSON, "apiv11". Base `https://gamebanana.com/apiv11`. Thinly documented, but public and
  used by Everest/Olympus (Celeste), Reloaded-II and others.
  - Game lookup: `GET /Util/Game/NameMatch?_sName=` (tested).
  - Mods per game: `GET /Mod/Index?_aFilters[Generic_Game]={id}&_nPage=&_nPerpage=` (tested).
  - Search: `GET /Util/Search/Results?_sModelName=Mod&_sSearchString=` (tested).
  - Files: `GET /Mod/{id}/DownloadPage` (tested).
- **Key:** none.
- **Downloads:** direct `_sDownloadUrl` (`https://gamebanana.com/dl/{fileId}`), with `_sMd5Checksum`,
  `_nFilesize` and a malware scan result `_sAnalysisResult` (tested). GameBanana also offers 1-click
  install buttons for registered mod managers through a custom URL scheme.
- **Limits and terms:** none published. Keep requests modest.
- **Metadata:** MD5, file size, `_sVersion` (when the author sets it), `_tsDateModified` for update
  checks, licence text. No dependency or load-order data.

## Factorio Mod Portal

- **Games:** Factorio only. 25,246 mods compatible with current versions (tested).
- **API:** REST/JSON. Base `https://mods.factorio.com/api`
  ([Mod portal API](https://wiki.factorio.com/Mod_portal_API), [Mod details API](https://wiki.factorio.com/Mod_details_API)).
  `GET /mods?page_size=&sort=&version=`, `GET /mods/{name}/full`, `POST /search` (JSON; needs the token).
- **Key:** none to browse. Downloads and `/search` need the player's factorio.com username and token.
  The game stores both in `player-data.json` (`service-username`, `service-token`) in its user data
  folder, so the launcher can read them with the player's permission, or ask via the
  [Web authentication API](https://wiki.factorio.com/Web_authentication_API).
- **Downloads:** `https://mods.factorio.com{download_url}?username=&token=`. Without them it redirects to
  the login page (tested).
- **Limits and terms:** third-party tools are welcome if they keep tokens safe, back off on errors and
  don't claim to be official ([usage guidelines](https://wiki.factorio.com/Factorio_HTTP_API_usage_guidelines)).
  The mod portal API is classed "internal", so it can change without notice.
- **Metadata:** `sha1`, `info_json.factorio_version`, `info_json.dependencies` (with `?` optional, `!`
  incompatible and `~` load-order-neutral markers), `released_at`. Factorio has no load order to manage.

## Modrinth

- **Games:** Minecraft (Java) only. Project types: mod, modpack, resource pack, shader, plugin,
  data pack, server (tested). 169,609 projects. The launcher already uses it.
- **API:** `https://api.modrinth.com/v2` ([docs](https://docs.modrinth.com/api/)). No key to read;
  300 requests a minute per IP. Files have SHA-1 and SHA-512 hashes and dependency lists.
- Nothing new to add for other games.

## Kerbal Space Program: SpaceDock and CKAN

**SpaceDock**

- **Games:** Kerbal Space Program (3,757 mods), Kerbal Space Program 2, Juno: New Origins, Kitten Space
  Agency and two more (tested `GET /api/games`).
- **API:** REST/JSON. Base `https://spacedock.info/api`. `GET /browse`, `GET /search/mod?query=`,
  `GET /mod/{id}` ([docs](https://spacedock.info/api)).
- **Key:** none. **Downloads:** direct from `versions[].download_path` (tested).
- **Metadata:** `game_version` per release, `friendly_version`, changelog, licence. No hashes.

**CKAN**

- **Games:** KSP (about 4,100 mods indexed) and KSP 2 (about 120).
- **API:** no server; the metadata is a Git repo. Download it whole as
  `https://github.com/KSP-CKAN/CKAN-meta/archive/master.tar.gz` (tested), or read single `.ckan` files
  ([spec](https://github.com/KSP-CKAN/CKAN/blob/master/Spec.md)).
- **Key:** none. **Downloads:** each `.ckan` points at the mod's own host (SpaceDock, GitHub, etc.).
- **Metadata:** the best of any source: `depends`, `recommends`, `conflicts`, `provides`, `ksp_version`
  ranges, `install` directives (which folder goes where), `download_hash` (SHA-1 and SHA-256), sizes.
  Licence MIT for the metadata.

## Beat Saber: BeatMods and BeatSaver

**BeatMods** (code mods)

- **Games:** Beat Saber. 132 verified mods for game version 1.40.8 on Steam (tested); hundreds across
  all versions.
- **API:** REST/JSON, rewritten in 2025. Base `https://beatmods.com/api`, Swagger UI at
  [beatmods.com/api/docs](https://beatmods.com/api/docs/).
  `GET /mods?gameName=BeatSaber&gameVersion=&status=verified&platform=steampc` (tested).
- **Key:** none. **Downloads:** direct, `https://beatmods.com/cdn/mod/{zipHash}.zip` (tested).
- **Metadata:** `dependencies`, `supportedGameVersions`, `zipHash` (MD5) plus per-file `contentHashes`
  (lets the launcher spot installed mods), `category` (core, library...), `status`.

**BeatSaver** (custom songs, not code)

- **API:** `https://api.beatsaver.com` ([docs](https://api.beatsaver.com/docs/)), keyless search such as
  `GET /search/text/0?q=` (tested). Direct `downloadURL` per version plus a SHA-1 `hash` (tested).
- Fits a "custom songs" tab more than the mod list.

## GitHub releases

- **Use:** update checks and downloads for mods that publish on GitHub. SMAPI (Stardew Valley) does
  this with `GitHub:owner/repo` update keys, alongside Nexus, CurseForge and ModDrop.
- **API:** `GET https://api.github.com/repos/{owner}/{repo}/releases/latest`
  ([docs](https://docs.github.com/en/rest/releases/releases)).
- **Key:** none, but only 60 requests an hour per IP; a personal token raises that to 5,000. The launcher
  already has a `github` personal secret.
- **Downloads:** direct `browser_download_url`. Release assets now carry a `digest` (`sha256:...`)
  (tested on SMAPI 4.5.2).

## Stardew Valley extras: SMAPI's web API and ModDrop

- **smapi.io API:** `POST https://smapi.io/api/v{version}/mods` checks updates for many mods at once
  across Nexus, CurseForge, ModDrop and GitHub, given each mod's `UpdateKeys` from its `manifest.json`.
  This is what SMAPI itself calls ([source](https://github.com/Pathoschild/SMAPI/tree/develop/src/SMAPI.Web)).
  No key. Check with Pathoschild before relying on it from another app.
- **ModDrop:** no documented API. SMAPI uses an undocumented `POST https://www.moddrop.com/api/mods/data`
  (`{"ModIDs":[...],"Files":true,"Mods":true}`), which answered without a key (tested). Good for update
  checks only; don't build browsing on it without asking ModDrop.

## ESOUI and WoWInterface (MMOUI)

- **Games:** The Elder Scrolls Online (4,362 add-ons, tested) and World of Warcraft.
- **API:** `https://api.mmoui.com/v4/game/{ESO|WOW}/filelist.json` (whole list, 2 to 4 MB) and
  `/filedetails/{id}.json` (tested). Used by the official Minion manager. Undocumented; ask MMOUI before
  shipping.
- **Key:** none. **Downloads:** direct `downloadUri` with an MD5 `checksum` (tested).
- **Metadata:** `gameVersions`, `addons` (folder names and their dependencies), `version`, `lastUpdate`.

## Wago Addons

- **Games:** World of Warcraft.
- **API:** `https://addons.wago.io/api/external/...`; 401 without a key (tested).
- **Key:** personal and paid: players get one by supporting Wago on Patreon. Partner apps (WowUp, Wago
  App) get access by agreement. **Personal key**, only if WoW support is added.

## Others with APIs worth knowing

- **LCPDFR (GTA V police mods):** keyless update check
  `GET https://www.lcpdfr.com/applications/downloadsng/interface/api.php?do=checkForUpdates&fileId={id}`
  returns the latest version and page (tested). Downloads need a login.
- **ModelSaber (Beat Saber sabers, avatars, platforms):** keyless `https://modelsaber.com/api/v2/get.php`.
- **Hangar (Paper/Velocity Minecraft server plugins):** keyless `https://hangar.papermc.io/api/v1`
  (tested). Only matters if server plugins are added.

## No public API

- **ModDB:** no API. RSS feeds exist at `rss.moddb.com` but answered 403 to a plain client (tested; it
  sits behind bot protection). Its sister site mod.io is the sanctioned API.
- **The Sims Resource:** no API, no feed; downloads need its site (and an ad wait or VIP).
- **GTA5-Mods:** no API (tested: `/api` is 404), no feed for downloads. Link out only.
- **Overtake (RaceDepartment):** no API (tested: 403). Link out only.
- **Bethesda.net Creations:** no external API. Creations download only through the in-game menu
  (Skyrim SE, Fallout 4, Starfield), and paid ones need Bethesda's own purchase.
- **Paradox Mods (Cities: Skylines II, others):** no public API. The game and Skyve use it with a
  Paradox login. Link to `mods.paradoxplaza.com`.
- **Nexus Mods and CurseForge:** already in the launcher.

## Which sources have mods for which game

● main source · ○ some mods · blank none. "Launcher has" means already wired up.

| Game | Launcher has | Thunderstore | Steam Workshop | mod.io | GameBanana | Own portal | Other |
|---|---|---|---|---|---|---|---|
| Skyrim | Nexus, CurseForge | | ○ original edition only | | ○ 103 | | Bethesda Creations (no API) |
| Fallout 4 | Nexus, CurseForge | | | | ○ 30 | | Bethesda Creations (no API) |
| Cyberpunk 2077 | Nexus, CurseForge | | | | ○ 13 | | |
| Baldur's Gate 3 | Nexus, CurseForge | | | ● official in-game source | | | |
| Stardew Valley | Nexus, CurseForge | | | | ○ 10 | | ModDrop, GitHub, smapi.io update API |
| The Sims 4 | CurseForge | | | | ○ 30 | | TSR, Patreon (no API) |
| GTA V | Nexus | | | | ○ 47 | | GTA5-Mods (no API), LCPDFR update check |
| Valheim | Nexus | ● 15.9k | | | ○ 3 | | |
| Lethal Company | Nexus | ● 55k | | | ○ 21 | | |
| RimWorld | Nexus | | ● | | ○ 1 | | GitHub releases |
| Cities: Skylines | Nexus | | ● | | ○ 1 | | II: Paradox Mods (no API), Thunderstore ○ 284 |
| Kerbal Space Program | CurseForge | | ○ craft files | | | ● SpaceDock 3.8k, CKAN 4.1k | GitHub releases |
| Factorio | | | | | ○ 20 | ● Factorio Mod Portal 25k | |
| Beat Saber | | | | | | ● BeatMods | BeatSaver (songs), ModelSaber |
| Minecraft | Modrinth, CurseForge | | | | ○ 948 | | Hangar (server plugins) |

"Launcher has" reflects what each game is mapped to in `electron/games/registry.cjs` on 2026-11-18;
check it before relying on this column.

## In the launcher now

Added on 2026-11-18, each as a module in `electron/games/sources/` (`index.cjs` lists them).
They show in a game's Discover page when they have mods for it, mixed under "Any site", or
picked on their own from the site menu.

| Site | Key | Installs | Notes |
|---|---|---|---|
| Thunderstore | none | direct, with dependencies | 162 communities mapped by Steam app id (`thunderstoreSteam.json`); latest version only |
| mod.io | the player's own read-only key (`MODIO_API_KEY`) | direct, MD5-checked | a file with no download link opens its page |
| Steam Workshop | the launcher's host (`/steam/*` on the Worker), or the player's own Steam Web API key (`STEAM_WEB_API_KEY`), which wins | opens the item in Steam to Subscribe | listed as "(add a key)" for Steam games when neither is there |
| Factorio Mod Portal | optional `username:token` (`FACTORIO_TOKEN`) | direct, SHA-1-checked, with dependencies | browsing works keyless; search and downloads need the token |
| SpaceDock | none | direct | Kerbal Space Program only; no dependency data (CKAN has it) |
| BeatMods | none | direct, MD5-checked, with dependencies | the newest Beat Saber version with checked mods, of the last 12 |
| GameBanana | none | direct, MD5-checked; refuses files its virus scan flagged | only joins "Any site" when the game has no other source |
| ModWorkshop | none | direct, with dependencies | about 70 games, matched by the Steam id in its game links or by name; mods whose authors set `disable_mod_managers` open on the site |
| ficsit.app | none | direct (`.smod`, a zip of one plugin), with dependencies, SML included | Satisfactory only; GraphQL; Windows builds only (Mac and Linux targets are servers) |
| Vintage Story Mod DB | none | direct (the game reads the zip as it is) | its list comes whole, so it's cached 30 minutes and paged in the launcher; no dependency data |
| ContentDB | none | direct, with hard dependencies | Luanti (Minetest); cached 10 minutes and paged in the launcher; a need nothing is named after (like `default`) comes with the game |
| idgames | none | direct, from the youfailit.net mirror | Doom, Doom II, Final Doom; title search needs 3+ letters, an empty search shows the megawads; author e-mails in text files are hidden |

The first seven were added on 2026-11-18, the last five on 2026-11-24. Keys are added in Settings →
Mod sites, which lists every site with its games and is searchable by site or game. Updates are checked
for every site except the Workshop (Steam updates those).

### The Workshop through the launcher's host

The Cloudflare Worker in `proxy/curseforge/` also answers three Steam routes, with the launcher's own
Steam Web API key (the `STEAM_WEB_API_KEY` secret): `/steam/IPublishedFileService/QueryFiles/v1/`,
`/steam/IPublishedFileService/GetDetails/v1/` and `/steam/ISteamUser/GetPlayerSummaries/v2/`. Each
rebuilds the query from a short whitelist (so a caller's own `key` is dropped), is rate-limited per IP
and cached. `GET /status` says which keys the Worker holds (`{ curseforge, steam }`); the launcher
checks it every 10 minutes to decide whether the Workshop can be searched without a personal key.
mod.io stays a personal key: its per-key limit (60 requests a minute) and terms don't suit one shared key.

### New sources, 2026-11-24

- **ModWorkshop** ([OpenAPI](https://api.modworkshop.net/.openapi)): keyless REST at
  `https://api.modworkshop.net`, open to community mod managers that don't hammer it. Needs
  `Accept: application/json`, or it answers with HTML. `GET /games` (paged) lists games with a `buttons`
  string holding the Steam store link; `GET /games/{id}/mods?sort=&query=`; `GET /mods/{id}` and
  `/mods/{id}/files`. Sorts: `weekly_score`, `downloads`, `bumped_at`, `published_at`, `best_match`.
- **ficsit.app** (`https://api.ficsit.app/v2/query`, GraphQL): `getMods(filter: ModFilter)` and
  `getModByReference(modReference:)`, versions with `targets { targetName link size }` and
  `dependencies { mod_id optional }`. Satisfactory Mod Manager's own source.
- **Vintage Story Mod DB** (`https://mods.vintagestory.at/api`): `GET /api/mods?orderby=&text=` returns
  the whole list (about 10,000); `GET /api/mod/{alias or id}` has releases with `mainfile` download
  links and game-version tags.
- **ContentDB** ([API help](https://content.luanti.org/help/api/)): `GET /api/packages/?type=mod&sort=&order=&q=`
  (not paged), `/api/packages/{author}/{name}/releases/` and `/dependencies/?only_hard=1`. The
  `/api/scores/` endpoint answered 500 when tested, so the list shows no download counts from it.
- **idgames** ([API](https://www.doomworld.com/idgames/api/)): `api.php?action=search|get|getcontents&out=json`.
  Files from the archive's mirrors; one file comes as an object, several as a list.

### Looked at and left out (2026-11-24)

- **Hollow Knight ModLinks:** the mods need the game's `Assembly-CSharp.dll` patched first, which the
  launcher doesn't do.
- **ESOUI and WoWInterface (MMOUI):** the API is undocumented; ask MMOUI before using it.
- **Wago Addons:** paid API access, World of Warcraft only.
- **ModDrop, LCPDFR:** update checks only; downloads need a login.
- **CKAN, BeatSaver, ModelSaber, Hangar, smapi.io:** metadata, songs or skins, server plugins, or update
  data rather than mods the Discover page can install.
- **No public API:** ModDB, The Sims Resource, GTA5-Mods, Planet Minecraft, Mod Collective, Overtake,
  Bethesda Creations, Paradox Mods.

### Discover's Sites tab (2026-11-24)

Each game's Discover page has a Sites tab: every website with mods for that game, each opening in the
browser. The hand-picked list is `electron/shared/gameModSites.mjs` (37 games: every built-in and
catalog game except Minecraft and GTA VI). The sites Discover searches for a game join the list too, from
each provider's `home(ctx)` page, so a game added from a search still gets its Nexus Mods,
Thunderstore or Workshop link. Rows are marked "In Discover" (its mods are on the Mods tab) or
"Website only" (download in the browser, then Add from Downloads). `games:openUrl` opens https links
to the listed sites' hosts only. Adult-only sites, cheat sites and sites that re-upload paid mods are
left out.
