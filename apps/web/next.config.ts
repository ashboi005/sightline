import { varlockNextConfigPlugin } from "@varlock/nextjs-integration/plugin";

const withVarlock = varlockNextConfigPlugin();
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  webpack(config) {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, crypto: false };
    return config;
  },
  reactCompiler: true,
  output: "standalone",
};

export default withVarlock(nextConfig);
