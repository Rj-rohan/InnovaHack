import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { getChainProfile, rpcUrl } from "./chains";

/**
 * Wallet config for the owner's freeze button.
 *
 * The owner signs from their own wallet rather than from a server-held key. That is partly UX and
 * mostly argument: it makes visible that the machine running the agent has no way to unfreeze
 * itself.
 *
 * The chain comes from the profile registry, so pointing the app at a public network is an env
 * change rather than an edit here. Against a local node, import a Hardhat account into MetaMask
 * once — the owner is account #0.
 */
const profile = getChainProfile();

export const wagmiConfig = createConfig({
  chains: [profile.viemChain],
  connectors: [injected()],
  transports: {
    [profile.viemChain.id]: http(rpcUrl()),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
