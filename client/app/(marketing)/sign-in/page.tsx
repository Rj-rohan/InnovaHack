import type { Metadata } from "next";
import { SignInCard } from "@/components/sign-in-card";

export const metadata: Metadata = {
  title: "Owner access",
  description:
    "Connect the owner wallet to change policy on the Kill Switch. There is no account and no password — ownership is proven on-chain.",
};

export default function SignInPage() {
  return <SignInCard />;
}
