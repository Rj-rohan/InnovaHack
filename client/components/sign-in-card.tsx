"use client";

import Link from "next/link";
import { useChainId, useDisconnect, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";
import { DotField } from "@/components/ui/dot-field";
import { useFreeze } from "@/lib/use-freeze";
import { useKillSwitch } from "@/lib/use-kill-switch";
import { useWalletConnection } from "@/lib/use-wallet-connection";
import { Button, ButtonLink } from "@/components/ui/button";
import { shortenAddress } from "@/lib/format";

/**
 * Owner access.
 *
 * There is no account here, and that is the point rather than an omission. The contract decides
 * who the owner is — `onlyOwner` compares `msg.sender` against a stored address — so an email and
 * password would authenticate someone to a website that has no power to act on their behalf. The
 * credential that matters is the key, and it stays in the visitor's wallet.
 *
 * The screen still does the job a sign-in screen does: it tells you who you are, whether that is
 * enough, and what to do if it isn't.
 */
export function SignInCard() {
  const { address, isConnected, hasProvider, openWallet, isPending, error } =
    useWalletConnection();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const data = useKillSwitch();
  const freeze = useFreeze(data.contracts?.agentWallet);

  const owner = freeze.owner ?? data.owner ?? null;
  const wrongNetwork = isConnected && chainId !== sepolia.id;
  const noWallet = hasProvider === false;

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden px-5 py-12">
      <div className="absolute inset-0 z-0" aria-hidden="true">
        <DotField className="h-full w-full" />
      </div>

      {/* Vignette, so the card is not competing with the field behind it. */}
      <div
        className="absolute inset-0 z-1"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(circle at center, rgb(31 37 35 / .8) 0%, rgb(31 37 35 / .35) 55%, var(--color-enamel) 100%)",
        }}
      />

      <div className="m-panel seat relative z-10 w-full max-w-md px-7 py-8">
        <div className="flex flex-col items-center text-center">
          <span className="sign-in-mark" aria-hidden="true" />
          <h1 className="heading mt-5 text-lead text-placard">Owner access</h1>
          <p className="mt-2 max-w-xs text-body text-placard/65">
            Connect the wallet that owns the contract. Everything on the dashboard is readable
            without it.
          </p>
        </div>

        <hr className="rule-engraved my-7" />

        {noWallet ? (
          <div>
            <p className="legend text-hazard">No wallet detected</p>
            <p className="mt-2 text-body text-placard/70">
              Install MetaMask or another browser wallet, then reload this page.
            </p>
          </div>
        ) : !isConnected ? (
          <Button variant="primary" className="w-full" disabled={isPending} onClick={openWallet}>
            {isPending ? "Check your wallet…" : "Connect wallet"}
          </Button>
        ) : wrongNetwork ? (
          <div>
            <p className="legend text-hazard">Wrong network</p>
            <p className="mt-2 text-body text-placard/70">
              The wallet lives on Sepolia. Switch, and this page updates itself.
            </p>
            <Button
              variant="primary"
              className="mt-4 w-full"
              onClick={() => switchChain({ chainId: sepolia.id })}
            >
              Switch to Sepolia
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <dl className="m-well flex flex-col gap-2.5 px-4 py-3.5">
              <Row label="Connected" value={address} />
              <Row label="Contract owner" value={owner} />
            </dl>

            {freeze.isOwner ? (
              <p className="legend flex items-center gap-2 text-running">
                <span className="led led-running" aria-hidden="true" />
                You own this wallet
              </p>
            ) : owner ? (
              <p className="legend flex items-start gap-2 text-hazard">
                <span className="led led-caution mt-1" aria-hidden="true" />
                <span className="normal-case tracking-normal">
                  This wallet isn&apos;t the owner. You can watch, not change.
                </span>
              </p>
            ) : (
              <p className="legend text-placard/50">Waiting for the contract to answer</p>
            )}

            <ButtonLink href="/console" variant="primary" className="w-full">
              Open the console
            </ButtonLink>

            <Button variant="ghost" className="w-full" onClick={() => disconnect()}>
              Disconnect
            </Button>
          </div>
        )}

        {error && (
          <p className="legend mt-4 text-estop" role="alert">
            {error}
          </p>
        )}

        <hr className="rule-engraved my-7" />

        <p className="text-center text-legend leading-relaxed text-placard/45">
          No account and no password. The contract checks the signing address against its stored
          owner, so nothing on this page can grant access the chain would refuse.
        </p>

        <p className="mt-4 text-center">
          <Link
            href="/"
            className="legend text-placard/55 underline decoration-placard/25 underline-offset-4 transition-colors hover:text-placard"
          >
            ← Back
          </Link>
        </p>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="legend text-placard/45">{label}</dt>
      <dd className="font-mono text-legend text-placard/85" title={value ?? undefined}>
        {value ? shortenAddress(value) : "—"}
      </dd>
    </div>
  );
}
