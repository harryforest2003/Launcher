import { Axe, Crosshair, Hammer, Pickaxe, Shield, Shovel, Sword, Swords, type LucideIcon } from "lucide-react";

export const START_ITEMS: { id: string; name: string; sub: string; icon: LucideIcon }[] = [
  { id: "diamond_sword", name: "Sword", sub: "Swords, daggers, katanas", icon: Sword },
  { id: "diamond_axe", name: "Axe", sub: "Axes, hatchets, cleavers", icon: Axe },
  { id: "diamond_pickaxe", name: "Pickaxe", sub: "Picks and mining tools", icon: Pickaxe },
  { id: "diamond_shovel", name: "Shovel", sub: "Shovels, spades, scoops", icon: Shovel },
  { id: "bow", name: "Bow", sub: "Bows and slingshots", icon: Crosshair },
  { id: "trident", name: "Trident", sub: "Spears, forks, staffs", icon: Swords },
  { id: "mace", name: "Mace", sub: "Hammers, clubs, maces", icon: Hammer },
  { id: "shield", name: "Shield", sub: "Shields and bucklers", icon: Shield },
];
