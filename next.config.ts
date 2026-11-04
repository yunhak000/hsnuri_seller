import type { NextConfig } from "next";
import { randomUUID } from "node:crypto";

const appVersion =
  process.env.NODE_ENV === "development"
    ? "development"
    : process.env.VERCEL_GIT_COMMIT_SHA || randomUUID();

const nextConfig: NextConfig = {
  reactCompiler: true,
  deploymentId: appVersion === "development" ? undefined : appVersion,
  env: { NEXT_PUBLIC_APP_VERSION: appVersion },
};

export default nextConfig;
