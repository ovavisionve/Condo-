"use client";

import { useEffect, useState } from "react";

// El evento BeforeInstallPromptEvent no está en los tipos estándar de TS
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Detectar si ya está instalada como PWA
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
      return;
    }

    // Detectar iOS (Safari no dispara beforeinstallprompt)
    const ua = navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua);
    setIsIos(ios);

    // Recuperar si el usuario ya cerró el banner
    const dismissed = localStorage.getItem("pwa-banner-dismissed");
    if (dismissed) return;

    if (ios) {
      // En iOS mostrar instrucciones manuales
      const iosSafari = /safari/i.test(ua) && !/crios|fxios|opios/i.test(ua);
      if (iosSafari) setShow(true);
      return;
    }

    // Android/Chrome: esperar el evento nativo
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShow(false);
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShow(false);
    localStorage.setItem("pwa-banner-dismissed", "1");
  };

  if (!show || isInstalled) return null;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-50 bg-slate-800 text-white rounded-2xl shadow-2xl p-4 flex items-start gap-3 max-w-sm mx-auto"
      role="banner"
    >
      {/* Icono */}
      <div className="shrink-0 w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center text-lg">
        🏢
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">Instalar ResidIA</p>
        {isIos ? (
          <p className="text-xs text-slate-300 mt-0.5">
            Toca <strong>Compartir</strong> → <strong>Agregar a pantalla de inicio</strong>
          </p>
        ) : (
          <p className="text-xs text-slate-300 mt-0.5">
            Instala la app para acceso rápido sin internet
          </p>
        )}
      </div>

      <div className="flex flex-col items-end gap-1 shrink-0">
        {!isIos && (
          <button
            onClick={handleInstall}
            className="text-xs bg-blue-500 hover:bg-blue-400 px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            Instalar
          </button>
        )}
        <button
          onClick={handleDismiss}
          className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          Ahora no
        </button>
      </div>
    </div>
  );
}
