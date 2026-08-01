"use client";

import { useCallback, useState } from "react";
import { parseGwei } from "viem";
import { useAccount, useReadContract, usePublicClient, useWriteContract } from "wagmi";
import { walletControlAbi } from "./wallet-abi";

/**
 * Headless owner controls. Renders nothing — the UI supplies the button.
 *
 * Signed by the connected wallet, so only the actual owner key can pause. If a non-owner presses
 * the button the contract reverts with `NotOwner()`, which is the correct outcome and worth
 * showing rather than hiding behind a disabled state.
 */

export type FreezeStatus = "idle" | "signing" | "pending" | "done" | "error";

export interface FreezeControls {
  paused: boolean | undefined;
  owner: `0x${string}` | undefined;
  isOwner: boolean;
  connected: boolean;
  status: FreezeStatus;
  error: string | null;
  txHash: `0x${string}` | null;
  freeze: () => Promise<void>;
  unfreeze: () => Promise<void>;
  throttle: (bps: number) => Promise<void>;
  refetch: () => void;
}

export function useFreeze(walletAddress: `0x${string}` | undefined): FreezeControls {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [status, setStatus] = useState<FreezeStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const pausedQuery = useReadContract({
    address: walletAddress,
    abi: walletControlAbi,
    functionName: "paused",
    query: { enabled: Boolean(walletAddress), refetchInterval: 4000 },
  });

  const ownerQuery = useReadContract({
    address: walletAddress,
    abi: walletControlAbi,
    functionName: "owner",
    query: { enabled: Boolean(walletAddress) },
  });

  const run = useCallback(
    async (functionName: "pause" | "unpause" | "setThrottle", args: readonly unknown[] = []) => {
      if (!walletAddress) return;

      setStatus("signing");
      setError(null);
      setTxHash(null);

      try {
        const hash = await writeContractAsync({
          address: walletAddress,
          abi: walletControlAbi,
          functionName,
          args: args as never,
          // The freeze is racing the agent's next payment for a block slot. On Sepolia's ~12s
          // blocks, losing that race means the payment lands first and the demo tells the wrong
          // story, so the kill switch pays for priority.
          maxPriorityFeePerGas: parseGwei("3"),
        });

        setTxHash(hash);
        setStatus("pending");

        await publicClient?.waitForTransactionReceipt({ hash });
        setStatus("done");
        void pausedQuery.refetch();
      } catch (cause) {
        setStatus("error");
        const message = cause instanceof Error ? cause.message : String(cause);
        // viem surfaces the whole simulated stack; the first line is the useful part.
        setError(message.split("\n")[0] ?? "transaction failed");
      }
    },
    [walletAddress, writeContractAsync, publicClient, pausedQuery],
  );

  return {
    paused: pausedQuery.data as boolean | undefined,
    owner: ownerQuery.data as `0x${string}` | undefined,
    isOwner:
      Boolean(address) &&
      Boolean(ownerQuery.data) &&
      String(address).toLowerCase() === String(ownerQuery.data).toLowerCase(),
    connected: isConnected,
    status,
    error,
    txHash,
    freeze: () => run("pause"),
    unfreeze: () => run("unpause"),
    throttle: (bps: number) => run("setThrottle", [bps]),
    refetch: () => void pausedQuery.refetch(),
  };
}
