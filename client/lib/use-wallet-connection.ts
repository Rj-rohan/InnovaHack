"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";

/**
 * One place that knows how to open a wallet, so every entry point behaves the same.
 *
 * The bug this exists to kill: `useConnect()` reports failures through `error`, and a button that
 * ignores it does nothing visible when there is no wallet installed or the user dismisses the
 * prompt. Silence is the worst possible answer — the visitor cannot tell the difference between
 * a broken button and a refused connection.
 */
export function useWalletConnection() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error, reset } = useConnect();

  // Null until mounted. `window.ethereum` does not exist while rendering on the server, and
  // branching on it during render would hydrate differently than it rendered.
  const [hasProvider, setHasProvider] = useState<boolean | null>(null);

  useEffect(() => {
    const detect = () =>
      setHasProvider(Boolean((globalThis as { ethereum?: unknown }).ethereum));

    detect();

    // Extensions inject asynchronously and can land after first paint. EIP-6963 announces them.
    window.addEventListener("eip6963:announceProvider", detect);
    const timer = window.setTimeout(detect, 1200);

    return () => {
      window.removeEventListener("eip6963:announceProvider", detect);
      window.clearTimeout(timer);
    };
  }, []);

  const openWallet = useCallback(() => {
    // Prefer a provider the browser actually announced over the generic injected shim.
    const connector =
      connectors.find((candidate) => candidate.type === "injected") ?? connectors[0];

    if (!connector) return;

    reset(); // Clear a previous failure so a retry does not show a stale message.
    connect({ connector });
  }, [connect, connectors, reset]);

  return {
    address,
    isConnected,
    /** null while undetermined, false when no browser wallet was found. */
    hasProvider,
    openWallet,
    isPending,
    error: error ? (error.message.split("\n")[0] ?? "Could not connect") : null,
  };
}
