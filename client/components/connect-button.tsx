"use client";

import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";
import { shortenAddress } from "@/lib/format";

/**
 * Wallet connection for the owner.
 *
 * Three states, each saying what to do rather than what is wrong: not connected, connected to the
 * wrong network, connected. The dashboard itself holds no keys — everything readable on the page
 * stays readable without connecting.
 */
export function ConnectButton({ className = "" }: { className?: string }) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const injected = connectors[0];

  if (!isConnected) {
    return (
      <button
        type="button"
        className={`legend m-panel px-3 py-2 text-placard transition-colors hover:bg-enamel-lo ${className}`}
        disabled={!injected || isPending}
        onClick={() => injected && connect({ connector: injected })}
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  if (chainId !== sepolia.id) {
    return (
      <button
        type="button"
        className={`legend px-3 py-2 text-ink transition-opacity hover:opacity-90 ${className}`}
        style={{ backgroundColor: "var(--color-hazard)" }}
        onClick={() => switchChain({ chainId: sepolia.id })}
      >
        Switch to Sepolia
      </button>
    );
  }

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
