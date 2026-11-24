/*
 * Whether a Minecraft version can open a world as the game starts (Quick Play, from 1.20
 * and snapshot 23w14a). Any version can join a server that way. electron/minecraft/launch.cjs
 * decides the same from the version file when the game starts.
 */
export function opensWorlds(mcVersion: string): boolean {
  const snapshot = /^(\d\d)w(\d\d)/.exec(mcVersion);
  if (snapshot) return Number(snapshot[1]) > 23 || (Number(snapshot[1]) === 23 && Number(snapshot[2]) >= 14);
  const [major, minor] = mcVersion.split(/[.-]/).map(Number);
  return major >= 2 || (major === 1 && minor >= 20);
}
