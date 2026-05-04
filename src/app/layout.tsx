import type { Metadata, Viewport } from "next";
import { Providers } from "./Providers";
import { PwaInstallBanner } from "@/components/PwaInstallBanner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Condominios",
  description: "Sistema de gestión de condominios para Venezuela",
  applicationName: "Condominios Venezuela",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Condominios",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#1e293b",
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        {/* Soporte iOS PWA */}
        <link rel="apple-touch-icon" href="/icons/192" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body>
        <Providers>{children}</Providers>
        <PwaInstallBanner />
      </body>
    </html>
  );
}
