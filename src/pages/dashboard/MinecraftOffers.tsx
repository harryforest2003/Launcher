import { ArrowUpRight, Gift, ShoppingBag, Play } from "lucide-react";

const IMG = "https://launchercontent.mojang.com/v2/images/";
const links = [
  { title: "Buy Minecraft", description: "Editions and current offers.", href: "https://www.minecraft.net/en-us/store/minecraft-java-bedrock-edition-pc", art: IMG + "26.2540x540.jpg", icon: ShoppingBag },
  { title: "Try Minecraft", description: "The official free trial.", href: "https://www.minecraft.net/en-us/free-trial", art: IMG + "dappledcamp540x540.jpg", icon: Play },
  { title: "Redeem a code", description: "Have a gift code? Redeem it.", href: "https://www.minecraft.net/en-us/redeem", art: IMG + "1.21.9540x540.jpg", icon: Gift },
];

export default function MinecraftOffers() {
  return (
    <section className="db-card mh-offers" aria-labelledby="minecraft-offers-title">
      <header className="db-card__head">
        <h2 className="db-card__title" id="minecraft-offers-title">Minecraft offers</h2>
        <span className="db-card__meta">minecraft.net, opens in your browser</span>
      </header>
      <div className="mh-offers__links">
        {links.map(({ title, description, href, art, icon: Icon }) => (
          <a key={href} className="mh-offers__link" href={href} target="_blank" rel="noopener noreferrer">
            <span className="mh-offers__art" aria-hidden="true">
              <img src={art} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onError={(e) => { e.currentTarget.style.display = "none"; }} />
              <span className="mh-offers__icon"><Icon size={16} /></span>
            </span>
            <span className="mh-offers__copy">
              <span className="mh-offers__title">{title}</span>
              <span className="mh-offers__lead">{description}</span>
            </span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        ))}
      </div>
      <p className="mh-offers__note">Prices vary by region. Java Edition runs on Windows, macOS and Linux; Bedrock for PC needs Windows.</p>
    </section>
  );
}
