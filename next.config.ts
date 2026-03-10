import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent trailing slash redirects (breaks Shopify webhooks)
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
