import type { NextConfig } from "next";
import path from "path";

const projectRoot = path.resolve(__dirname);

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: projectRoot,
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
