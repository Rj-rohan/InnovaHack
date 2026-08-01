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

/**
 * Full precision, trailing zeros kept: `38.000000`, never `38`.
 *
 * Used in the monospace placard tables where amounts sit in a column and have to align on the
 * decimal point. It is also the honest rendering on a page about spend limits — a reader who
 * sees `38` is left wondering what got rounded away.
 */
export function formatFixed6(value: string | bigint): string {
  const raw = typeof value === "bigint" ? value : BigInt(value || "0");
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;

  const base = 10n ** BigInt(DECIMALS);
  const whole = (abs / base).toLocaleString("en-US");
  const fraction = (abs % base).toString().padStart(DECIMALS, "0");

  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Percentage of a cap consumed, clamped to 100. Both arguments are base-unit strings. */
export function percentOf(part: string | bigint, whole: string | bigint): number {
  const p = typeof part === "bigint" ? part : BigInt(part || "0");
  const w = typeof whole === "bigint" ? whole : BigInt(whole || "0");
  if (w <= 0n) return 0;
  return Math.min(100, Number((p * 10000n) / w) / 100);
}

/**
 * Coarse on purpose. A countdown that changes every second gets re-announced every second by a
 * screen reader, and none of those announcements carry information the last one did not.
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "expired";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/** Block numbers are long enough that grouping is the difference between reading and counting. */
export function formatBlockNumber(block: string | bigint | number): string {
  try {
    return BigInt(block).toLocaleString("en-US");
  } catch {
    return String(block);
  }
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
