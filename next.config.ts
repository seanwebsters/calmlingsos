import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / WASM packages must not be bundled into the server build.
  serverExternalPackages: ["@electric-sql/pglite", "sharp", "ffmpeg-static", "ffprobe-static", "pg", "mammoth", "unpdf"],
  // Files read at runtime that the bundler can't see: migrations, the built-in
  // database's WASM assets, bundled FFmpeg/ffprobe and fonts.
  outputFileTracingIncludes: {
    "/**": [
      "./drizzle/**/*",
      "./assets/fonts/**",
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/ffprobe-static/bin/linux/x64/ffprobe",
      "./node_modules/@electric-sql/pglite/dist/*.{wasm,data,js,cjs}",
    ],
  },
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
