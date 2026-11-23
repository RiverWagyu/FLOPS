/**
 * Phone browsers (Safari, Chrome) have no built-in wallet. Wallets like MetaMask are a separate
 * app reached over WalletConnect, and the phone often doesn't switch to that app on its own when
 * the site asks for a signature. These helpers let the UI tell the user where to look.
 */

/** True for phones and tablets. iPadOS reports itself as a Mac, so it's told apart by touch points. */
export function isMobileUA(userAgent: string, maxTouchPoints = 0): boolean {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

export function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return isMobileUA(navigator.userAgent, navigator.maxTouchPoints);
}

/** A wallet injected into the page, as in MetaMask's or Coinbase Wallet's own in-app browser. */
export function hasInjectedWallet(): boolean {
  return typeof window !== "undefined" && typeof (window as { ethereum?: unknown }).ethereum !== "undefined";
}

/** On a phone, with no wallet in the page: wallet requests go to a separate app. */
export function walletIsSeparateApp(): boolean {
  return isMobile() && !hasInjectedWallet();
}

/** Opens this site inside MetaMask's in-app browser, where the confirm window pops up in place. */
export function metaMaskDappLink(href: string): string {
  const u = new URL(href);
  return `https://metamask.app.link/dapp/${u.host}${u.pathname}${u.search}`;
}

/** Opens the MetaMask app, where a pending WalletConnect request is waiting. */
export const METAMASK_APP_LINK = "https://metamask.app.link/";

/** Resolves to `fallback` if `p` hasn't settled within `ms`. Some wallets never answer unsupported calls. */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}
