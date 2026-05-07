"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { signOut } from "next-auth/react";

const INACTIVITY_MS = 30 * 60 * 1000;  // 30 min → cerrar sesión
const WARNING_MS   =  5 * 60 * 1000;   // aviso con 5 min de anticipación
const WARNING_SECS = 5 * 60;

export function InactivityGuard() {
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(WARNING_SECS);

  const logoutTimer   = useRef<ReturnType<typeof setTimeout>>();
  const warningTimer  = useRef<ReturnType<typeof setTimeout>>();
  const countdownTick = useRef<ReturnType<typeof setInterval>>();

  const clearAll = useCallback(() => {
    clearTimeout(logoutTimer.current);
    clearTimeout(warningTimer.current);
    clearInterval(countdownTick.current);
  }, []);

  const reset = useCallback(() => {
    clearAll();
    setShowWarning(false);
    setCountdown(WARNING_SECS);

    // A los 25 min → mostrar advertencia + countdown
    warningTimer.current = setTimeout(() => {
      setShowWarning(true);
      let secs = WARNING_SECS;
      countdownTick.current = setInterval(() => {
        secs -= 1;
        setCountdown(secs);
      }, 1000);
    }, INACTIVITY_MS - WARNING_MS);

    // A los 30 min → cerrar sesión
    logoutTimer.current = setTimeout(() => {
      void signOut({ callbackUrl: "/login" });
    }, INACTIVITY_MS);
  }, [clearAll]);

  useEffect(() => {
    const EVENTS = ["mousedown", "mousemove", "keydown", "scroll", "touchstart", "click", "wheel"];
    EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, reset));
      clearAll();
    };
  }, [reset, clearAll]);

  if (!showWarning) return null;

  const mins = Math.floor(countdown / 60);
  const secs = countdown % 60;
  const isUrgent = countdown <= 60;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center animate-in zoom-in-95 duration-200">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
          <svg className="h-7 w-7 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>

        <h2 className="text-lg font-bold text-slate-800 mb-2">Sesión por expirar</h2>
        <p className="text-slate-500 text-sm mb-4">
          Tu sesión cerrará automáticamente en
        </p>

        <div className={`text-4xl font-mono font-bold mb-6 tabular-nums ${isUrgent ? "text-red-600" : "text-slate-800"}`}>
          {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
        </div>

        <div className="space-y-2">
          <button
            onClick={reset}
            className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            Continuar sesión
          </button>
          <button
            onClick={() => void signOut({ callbackUrl: "/login" })}
            className="w-full text-slate-400 hover:text-slate-600 text-sm py-2 transition-colors"
          >
            Cerrar sesión ahora
          </button>
        </div>
      </div>
    </div>
  );
}
