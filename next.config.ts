import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components fica desligado nesta fase: toda tela é autenticada e
  // depende de consultas isoladas por organização. Ver docs/adr/0002.
  cacheComponents: false,
  poweredByHeader: false,
  serverExternalPackages: ["pg", "pg-boss", "sharp", "nodemailer"],
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
