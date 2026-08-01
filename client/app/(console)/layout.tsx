import { ConsoleDataProvider } from "@/components/console-data";
import { ConsoleShell } from "@/components/console-shell";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConsoleDataProvider>
      <ConsoleShell>{children}</ConsoleShell>
    </ConsoleDataProvider>
  );
}
