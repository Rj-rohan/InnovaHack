"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";

/**
 * Wrap `children` in app/layout.tsx with this to enable the owner freeze button:
 *
 *   <body className="m-chassis flex min-h-full flex-col">
 *     <Providers>{children}</Providers>
 *   </body>
 *
 * Not applied automatically — layout.tsx is owned by the UI work in progress.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  // Created in state, not at module scope: a module-level QueryClient is shared across requests
  // on the server and leaks one user's cached data into another's response.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
