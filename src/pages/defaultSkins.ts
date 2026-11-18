/*
 * Minecraft's own default skins, loaded from Mojang's texture server (the app's content
 * security policy already allows https images, and the server sends open CORS headers).
 */
export type DefaultSkin = { id: string; name: string; skin: string; slim: boolean };

const base = "https://textures.minecraft.net/texture/";

export const DEFAULT_SKINS: DefaultSkin[] = [
  { id: "steve", name: "Steve", skin: `${base}31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb`, slim: false },
  { id: "alex", name: "Alex", skin: `${base}46acd06e8483b176e8ea39fc12fe105eb3a2a4970f5100057e9d84d4b60bdfa7`, slim: true },
];
