import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / WASM packages must not be bundled into the server build.
  serverExternalPackages: ["@electric-sql/pglite", "sharp", "ffmpeg-static", "ffprobe-static", "pg", "mammoth", "unpdf"],
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*", "./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffprobe-static/bin/linux/x64/ffprobe"] },
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
