import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The PayPal and Claude SDKs run only on the server.
  serverExternalPackages: ["@paypal/agent-toolkit", "@paypal/paypal-server-sdk"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
