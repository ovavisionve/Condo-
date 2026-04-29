import type { Metadata } from "next";
import { TRPCProvider } from "@/lib/trpc/Provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Condominios",
  description: "Sistema de gestión de condominios para Venezuela",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <TRPCProvider>{children}</TRPCProvider>
      </body>
    </html>
  );
}
