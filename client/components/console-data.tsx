"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useConnect } from "wagmi";
import { useFreeze, type FreezeControls } from "@/lib/use-freeze";
import { useKillSwitch, type KillSwitchData } from "@/lib/use-kill-switch";

/**
 * One data subscription for the whole console.
 *
 * `useKillSwitch` opens its own EventSource each time it is called, so calling it in the shell
 * and again in every page would mean five live SSE connections rendering the same rows. The
 * console mounts it once, here, and shares the result.
 */

interface ConsoleData {
  data: KillSwitchData;
  freeze: FreezeControls;
  /** Authoritative paused flag: the direct contract read wins over the indexer's cache. */
  paused: boolean;
  /** Freeze/release, connecting the wallet first if there isn't one. */
  toggleFreeze: () => void;
}

const Ctx = createContext<ConsoleData | null>(null);

export function ConsoleDataProvider({ children }: { children: React.ReactNode }) {
  const data = useKillSwitch();
  const freeze = useFreeze(data.contracts?.agentWallet);
  const { connect, connectors } = useConnect();

  const paused = freeze.paused ?? data.state?.paused ?? false;

  const toggleFreeze = useCallback(() => {
    if (!freeze.connected) {
      const injected = connectors[0];
      if (injected) connect({ connector: injected });
      return;
    }
    void (paused ? freeze.unfreeze() : freeze.freeze());
  }, [freeze, paused, connect, connectors]);

  const value = useMemo(
    () => ({ data, freeze, paused, toggleFreeze }),
    [data, freeze, paused, toggleFreeze],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConsole(): ConsoleData {
  const value = useContext(Ctx);
  if (!value) throw new Error("useConsole must be used inside <ConsoleDataProvider>");
  return value;
}
