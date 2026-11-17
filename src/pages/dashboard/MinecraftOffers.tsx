import { ArrowUpRight, Gift, ShoppingBag, Play } from "lucide-react";

const links = [
  { title: "Buy Minecraft", description: "Compare editions and current offers on the official store.", href: "https://www.minecraft.net/en-us/store/minecraft-java-bedrock-edition-pc", icon: ShoppingBag },
  { title: "Try Minecraft", description: "Explore the official free trial and supported devices.", href: "https://www.minecraft.net/en-us/free-trial", icon: Play },
  { title: "Redeem a code", description: "Already have a gift code? Redeem it with Microsoft.", href: "https://www.minecraft.net/en-us/redeem", icon: Gift },
];

export default function MinecraftOffers() {
  return (
    <section className="mh-offers" aria-labelledby="minecraft-offers-title">
      <div className="mh-section-head">
        <h2 className="mh-section-title" id="minecraft-offers-title">Official Minecraft offers & links</h2>
        <span className="mh-offers__source">minecraft.net · Opens in your browser</span>
      </div>
      <div className="mh-offers__links">
        {links.map(({ title, description, href, icon: Icon }) => (
          <a key={href} className="mh-link mh-offers__link" href={href} target="_blank" rel="noopener noreferrer">
            <span className="mh-link__icon" aria-hidden="true"><Icon size={18} /></span>
            <span className="mh-offers__copy">
              <span className="mh-link__title">{title}</span>
              <span className="mh-link__lead">{description}</span>
            </span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        ))}
      </div>
      <p className="mh-offers__note">Prices and promotions vary by region; check the official store for current details. Java Edition supports Windows, macOS and Linux; Bedrock for PC requires Windows. Already own Minecraft? Sign in with the Microsoft account you used to buy it.</p>
    </section>
  );
}
