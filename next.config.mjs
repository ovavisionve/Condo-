import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  // Archivo fuente del service worker
  swSrc: "src/app/sw.ts",
  // Destino compilado (debe estar en public/ para que sea servido en la raíz)
  swDest: "public/sw.js",
  // Deshabilitar en desarrollo para evitar confusión con caché agresivo
  disable: process.env.NODE_ENV === "development",
});

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https: wss: ws:",
      // Permitir embed de PDFs generados in-memory (data: URLs y blob: URLs)
      // en <iframe>/<object> — necesario para el widget Previsualizar Recibo.
      "frame-src 'self' blob: data:",
      "object-src 'self' blob: data:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
    serverComponentsExternalPackages: ["bcryptjs"],
  },
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "localhost" },
      { protocol: "https", hostname: "**" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default withSerwist(nextConfig);
