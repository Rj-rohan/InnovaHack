import type { Metadata } from "next";
import { ConsoleDataProvider } from "@/components/console-data";
import { DemoStage } from "@/components/demo-stage";

export const metadata: Metadata = {
  title: "Demo",
  description:
    "Three scenarios run end to end: a normal payment, an attack the contract refuses, and a freeze landed mid-flight.",
};

export default function DemoPage() {
  return (
    <ConsoleDataProvider>
      <DemoStage />
    </ConsoleDataProvider>
  );
}
