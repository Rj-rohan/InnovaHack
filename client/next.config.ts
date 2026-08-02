import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["mongodb"],
  bundlePagesRouterDependencies: true,
  experimental: {
    turbo: undefined,
  },
};

export default nextConfig;
