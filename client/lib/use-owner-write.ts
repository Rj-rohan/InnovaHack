"use client";

import { useCallback, useState } from "react";
import { BaseError, ContractFunctionRevertedError, parseGwei } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { formatFixed6 } from "./format";
import { walletControlAbi } from "./wallet-abi";

/**
 * Owner writes other than the freeze, which has its own hook.
 *
 * Every revert is translated into a sentence with the actual numbers in it. A dashboard that
 * shows `0x82b42900` has made the owner do the contract's job; the ABI already carries enough to
 * say "over the per-transaction cap: tried 80.000000, cap is 40.000000".
 */

export type WriteStatus = "idle" | "signing" | "pending" | "done" | "error";

type OwnerFunction =
  | "setLimits"
  | "setCounterparty"
  | "setTagEnabled"
  | "grantSession"
  | "revokeSession";

function describeRevert(name: string, args: readonly unknown[] | undefined): string {
  const [a, b] = (args ?? []) as [unknown, unknown];

  switch (name) {
    case "NotOwner":
      return "Only the owner can change policy. The connected wallet isn't the owner.";
    case "WalletPaused":
      return "The wallet is frozen.";
    case "InvalidThrottle":
      return "Throttle must be between 0 and 100%.";
    case "ZeroAddress":
      return "That address is empty.";
    case "SpendLimitExceeded":
      return `Over the per-transaction cap: tried ${formatFixed6(a as bigint)}, cap is ${formatFixed6(b as bigint)}.`;
    case "RollingLimitExceeded":
      return `Over the 24-hour cap: tried ${formatFixed6(a as bigint)}, only ${formatFixed6(b as bigint)} left.`;
    case "InsufficientBalance":
      return `Not enough balance: tried ${formatFixed6(a as bigint)}, wallet holds ${formatFixed6(b as bigint)}.`;
    case "CounterpartyNotAllowed":
      return "That recipient is not on the allowlist.";
    case "SessionInvalid":
      return "That session key is revoked or expired.";
    case "SpendHistoryFull":
      return "The 24-hour spend history is full. It clears as older entries age out of the window.";
    default:
      return name;
  }
}

export function describeWriteError(cause: unknown): string {
  if (cause instanceof BaseError) {
    const revert = cause.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName) {
      return describeRevert(revert.data.errorName, revert.data.args);
    }
    // User rejection and other wallet-level failures land here.
    if (cause.shortMessage) return cause.shortMessage;
  }
  return cause instanceof Error ? (cause.message.split("\n")[0] ?? "Transaction failed") : String(cause);
}

export function useOwnerWrite(walletAddress: `0x${string}` | undefined) {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [status, setStatus] = useState<WriteStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setTxHash(null);
    setPendingKey(null);
  }, []);

  const send = useCallback(
    async (functionName: OwnerFunction, args: readonly unknown[], key?: string) => {
      if (!walletAddress) return false;

      setStatus("signing");
      setError(null);
      setTxHash(null);
      setPendingKey(key ?? functionName);

      try {
        const hash = await writeContractAsync({
          address: walletAddress,
          abi: walletControlAbi,
          functionName,
          args: args as never,
          // Policy changes race the agent's next payment for a block slot, same as the freeze.
          maxPriorityFeePerGas: parseGwei("3"),
        });

        setTxHash(hash);
        setStatus("pending");

        await publicClient?.waitForTransactionReceipt({ hash });
        setStatus("done");
        setPendingKey(null);
        return true;
      } catch (cause) {
        setStatus("error");
        setError(describeWriteError(cause));
        setPendingKey(null);
        return false;
      }
    },
    [walletAddress, writeContractAsync, publicClient],
  );

  return { status, error, txHash, pendingKey, send, reset };
}
