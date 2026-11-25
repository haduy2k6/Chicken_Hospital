import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Plan A: trình duyệt chỉ nói chuyện với origin của Next.js qua /api.
 * Next rewrite giữ nguyên URL trên thanh địa chỉ nên cookie refresh/role là cookie cùng site
 * (backend dùng sameSite=lax thay vì none). BACKEND_URL là origin backend, không có đường dẫn /api.
 */
const BACKEND_URL = (
  process.env.BACKEND_URL ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:4002")
).replace(/\/$/, "");
if (!BACKEND_URL) throw new Error("Thiếu biến môi trường BACKEND_URL");

const backend = new URL(BACKEND_URL);
if (backend.pathname !== "/" || backend.search || backend.hash) {
  throw new Error("BACKEND_URL phải là origin backend, ví dụ https://chicken-hospital.onrender.com");
}

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/:path*` }];
  },
  experimental: {
    agentFeedback: true,
    optimizePackageImports: ["lucide-react", "@heroui/react", "framer-motion", "gsap"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
};

export default withNextIntl(nextConfig);
