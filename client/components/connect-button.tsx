"use client";

import { useChainId, useDisconnect, useSwitchChain } from "wagmi";
import { shortenAddress } from "@/lib/format";
import { useWalletConnection } from "@/lib/use-wallet-connection";
import { Button } from "@/components/ui/button";
import { CHAIN_ID } from "@/lib/chains";

/**
 * Wallet connection for the owner.
 *
 * Four states, each saying what to do rather than what is wrong: no wallet installed, not
 * connected, connected to the wrong network, connected. Failures are shown — an earlier version
 * swallowed `useConnect().error`, so a click with no extension installed did nothing at all and
 * looked like a dead button.
 */
export function ConnectButton({ className = "" }: { className?: string }) {
  const { address, isConnected, hasProvider, openWallet, isPending, error } =
    useWalletConnection();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  if (isConnected && chainId !== CHAIN_ID) {
    return (
      <Button variant="primary" size="sm" className={className} onClick={() => switchChain({ chainId: CHAIN_ID })}>
        Switch network
      </Button>
    );
  }

  if (isConnected) {
    return (
      <button
        type="button"
        className={`legend m-panel group px-3 py-2 font-mono text-placard transition-colors hover:bg-enamel-lo ${className}`}
        onClick={() => disconnect()}
        title="Disconnect"
      >
        <span className="group-hover:hidden">{shortenAddress(address ?? "")}</span>
        <span className="hidden group-hover:inline">Disconnect</span>
      </button>
    );
  }

  // Detected as absent — send them somewhere useful instead of failing on click.
  if (hasProvider === false) {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noopener noreferrer"
        className={`legend m-panel px-3 py-2 text-placard transition-colors hover:bg-enamel-lo ${className}`}
        title="No browser wallet detected"
      >
        Install a wallet
      </a>
    );
  }

  return (
    <div className={`flex flex-col items-end gap-1 ${className}`}>
      <button
        type="button"
        className="legend m-panel px-3 py-2 text-placard transition-colors hover:bg-enamel-lo disabled:opacity-60"
        disabled={isPending}
        onClick={openWallet}
      >
        {isPending ? "Check your wallet…" : "Connect wallet"}
      </button>
      {error && (
        <p className="legend max-w-56 text-right text-estop" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
