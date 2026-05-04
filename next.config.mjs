import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  // Archivo fuente del service worker
  swSrc: "src/app/sw.ts",
  // Destino compilado (debe estar en public/ para que sea servido en la raíz)
  swDest: "public/sw.js",
  // Deshabilitar en desarrollo para evitar confusión con caché agresivo
  disable: process.env.NODE_ENV === "development",
});

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
};

export default withSerwist(nextConfig);
