/* Each game's own picture: its Steam store header, and Minecraft's from the Minecraft Launcher's
   release notes. Greyed for games that aren't on this computer; offline, initials stand in. */
const steamArt = (appId: string) =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;
export const ART: Record<string, string> = {
  minecraft: "https://launchercontent.mojang.com/v2/images/1.21.9540x540.jpg",
  sims4: steamArt("1222670"),
  gtav: steamArt("271590"),
  skyrimse: steamArt("489830"),
  fallout4: steamArt("377160"),
  cyberpunk2077: steamArt("1091500"),
  stardew: steamArt("413150"),
  terraria: steamArt("105600"),
  palworld: steamArt("1623730"),
  valheim: steamArt("892970"),
  bg3: steamArt("1086940"),
  rimworld: steamArt("294100"),
  rdr2: steamArt("1174180"),
  rdr1: steamArt("2668510"),
  eldenring: steamArt("1245620"),
  witcher3: steamArt("292030"),
  falloutnv: steamArt("22380"),
  starfield: steamArt("1716740"),
  // Newer store pages keep their header under a hashed path.
  oblivionremastered:
    "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2623190/a7cee9165bb1bfc092c390c5cff215ce0e381dfc/header.jpg",
  hogwartslegacy: steamArt("990080"),
  kcd2: steamArt("1771300"),
  bannerlord: steamArt("261550"),
  satisfactory: steamArt("526870"),
  ets2: steamArt("227300"),
  factorio: steamArt("427520"),
  sims3: steamArt("47890"),
  silksong: steamArt("1030300"),
  wukong: steamArt("2358720"),
  lethalcompany: steamArt("1966720"),
  subnautica: steamArt("264710"),
  schedule1: steamArt("3164500"),
  kenshi: steamArt("233860"),
  mhwilds: steamArt("2246340"),
};
