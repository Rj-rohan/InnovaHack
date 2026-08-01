"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useFreeze, type FreezeControls } from "@/lib/use-freeze";
import { useKillSwitch, type KillSwitchData } from "@/lib/use-kill-switch";
import { useWalletConnection } from "@/lib/use-wallet-connection";

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
  /** A failed wallet open. Separate from `freeze.error`, which is a failed transaction. */
  connectError: string | null;
}

const Ctx = createContext<ConsoleData | null>(null);

export function ConsoleDataProvider({ children }: { children: React.ReactNode }) {
  const data = useKillSwitch();
  const freeze = useFreeze(data.contracts?.agentWallet);
  const wallet = useWalletConnection();

  const paused = freeze.paused ?? data.state?.paused ?? false;
  const [controlError, setControlError] = useState<string | null>(null);

  const toggleFreeze = useCallback(() => {
    setControlError(null);

    if (!freeze.connected) {
      wallet.openWallet();
      return;
    }

    // `useFreeze` returns early with no address, which used to mean holding the switch did
    // nothing and said nothing. Never let the kill switch fail quietly.
    if (!data.contracts?.agentWallet) {
      setControlError("No wallet under management — there is nothing to freeze yet.");
      return;
    }

    void (paused ? freeze.unfreeze() : freeze.freeze());
  }, [freeze, paused, wallet, data.contracts?.agentWallet]);

  const value = useMemo(
    () => ({
      data,
      freeze,
      paused,
      toggleFreeze,
      connectError: wallet.error ?? controlError,
    }),
    [data, freeze, paused, toggleFreeze, wallet.error, controlError],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConsole(): ConsoleData {
  const value = useContext(Ctx);
  if (!value) throw new Error("useConsole must be used inside <ConsoleDataProvider>");
  return value;
}
