import AccountSwitcher from "./AccountSwitcher";
import PlatformAccountAction from "./PlatformAccountAction";
import { PLATFORMS } from "./platformAccountsData";

export default function PlatformAccounts() {
  return <section id="platform-accounts" aria-labelledby="platform-accounts-title" className="page-section">
    <h2 id="platform-accounts-title" className="page-section-title">Game accounts</h2>
    <p className="page-lead">Minecraft uses the account you pick: Microsoft, Ely.by or an offline test account. Other games use the account in their own platform launcher. Website sign-in does not connect that launcher to Unity.</p>
    <div className="ui-panel set-panel">
      <div className="platform-account-row"><div><h3>Minecraft</h3><p>Choose the account used to launch Minecraft.</p></div><AccountSwitcher /></div>
      {PLATFORMS.map(({ id, name }) => <div key={id} className="platform-account-row">
        <div><h3>{name}</h3><p>{id === "steam" ? "Sign in and switch players in the Steam app. Steam games use that client’s account." : `Manage your ${name} account on its official website; sign in to its desktop launcher to play.`}</p></div>
        <PlatformAccountAction provider={id} />
      </div>)}
      <div className="platform-account-row"><p>The Sims 4 on Steam also uses a linked EA account. <a href="https://help.ea.com/en/articles/ea-account/ea-account-linking/" target="_blank" rel="noopener noreferrer">EA’s account-linking guide ↗</a></p></div>
    </div>
  </section>;
}
