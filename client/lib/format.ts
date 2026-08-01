/** Formatting helpers shared by server and client components. No Node built-ins in here. */

const DECIMALS = 6;

/** Base units -> human string, without going through a float. */
export function formatUnits6(value: string | bigint): string {
  const raw = typeof value === "bigint" ? value : BigInt(value || "0");
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;

  const base = 10n ** BigInt(DECIMALS);
  const whole = abs / base;
  const fraction = abs % base;

  const wholeStr = whole.toLocaleString("en-US");
  if (fraction === 0n) return `${negative ? "-" : ""}${wholeStr}`;

  const fractionStr = fraction.toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${wholeStr}.${fractionStr}`;
}

export function formatUsdc(value: string | bigint): string {
  return `${formatUnits6(value)} mUSDC`;
}

export function shortenAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortenHash(hash: string): string {
  if (!hash || hash.length < 14) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/** Human sentence for a policy refusal. Deliberately states WHERE the decision was made. */
export function explainReason(reason: string | null): string {
  switch (reason) {
    case "Paused":
      return "Blocked on-chain — the wallet was frozen by the owner";
    case "SessionInvalid":
      return "Blocked on-chain — the agent's session key was revoked or expired";
    case "CounterpartyNotAllowed":
      return "Blocked on-chain — recipient is not on the allowlist";
    case "PerTxCapExceeded":
      return "Blocked on-chain — exceeds the per-transaction cap";
    case "RollingCapExceeded":
      return "Blocked on-chain — exceeds the rolling 24h spend cap";
    case "InsufficientBalance":
      return "Blocked on-chain — wallet balance too low";
    case null:
    case undefined:
      return "";
    default:
      return `Blocked on-chain — ${reason}`;
  }
}

export function timeAgo(date: Date | string): string {
  const then = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - then.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
