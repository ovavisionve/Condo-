"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// ─── Password strength ────────────────────────────────────────────────────────

function getStrength(pwd: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;

  if (score <= 1) return { score, label: "Muy débil", color: "bg-red-500" };
  if (score === 2) return { score, label: "Débil", color: "bg-orange-400" };
  if (score === 3) return { score, label: "Regular", color: "bg-yellow-400" };
  if (score === 4) return { score, label: "Fuerte", color: "bg-blue-500" };
  return { score, label: "Muy fuerte", color: "bg-green-500" };
}

// ─── Main form ────────────────────────────────────────────────────────────────

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [done, setDone] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Validate token
  const { data: tokenData, isLoading: validating } = trpc.authSecurity.validateResetToken.useQuery(
    { token },
    { enabled: Boolean(token) },
  );

  const { mutate, isPending, error } = trpc.authSecurity.resetPassword.useMutation({
    onSuccess: () => {
      setDone(true);
      setTimeout(() => router.push("/login"), 3000);
    },
  });

  const strength = getStrength(password);

  useEffect(() => {
    if (!password) { setValidationError(null); return; }
    if (password.length < 8) { setValidationError("Mínimo 8 caracteres"); return; }
    if (!/[A-Z]/.test(password)) { setValidationError("Debe incluir al menos una mayúscula"); return; }
    if (!/[0-9]/.test(password)) { setValidationError("Debe incluir al menos un número"); return; }
    setValidationError(null);
  }, [password]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validationError) return;
    if (password !== confirm) return;
    mutate({ token, password });
  };

  // No token
  if (!token) {
    return (
      <div className="text-center space-y-3">
        <p className="text-red-600 text-sm">Enlace inválido. No se encontró el token.</p>
        <Link href="/login/forgot-password" className="text-blue-600 text-sm hover:underline">
          Solicitar un nuevo enlace
        </Link>
      </div>
    );
  }

  // Loading
  if (validating) {
    return <div className="h-32 animate-pulse rounded-lg bg-muted" />;
  }

  // Token inválido o expirado
  if (!tokenData?.valid) {
    return (
      <div className="text-center space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
          <svg className="h-7 w-7 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <div>
          <p className="font-semibold text-slate-800">Enlace inválido o expirado</p>
          <p className="text-sm text-slate-500 mt-1">
            Este enlace ya fue usado o expiró (válido solo 15 minutos).
          </p>
        </div>
        <Link
          href="/login/forgot-password"
          className="inline-block text-sm text-blue-600 hover:underline"
        >
          Solicitar un nuevo enlace →
        </Link>
      </div>
    );
  }

  // Éxito
  if (done) {
    return (
      <div className="text-center space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
          <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <p className="font-semibold text-slate-800">¡Contraseña actualizada!</p>
          <p className="text-sm text-slate-500 mt-1">
            Redirigiendo al inicio de sesión...
          </p>
        </div>
      </div>
    );
  }

  const canSubmit = !validationError && password === confirm && password.length >= 8 && !isPending;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {tokenData.email && (
        <p className="text-sm text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
          Cambiando contraseña para: <strong>{tokenData.email}</strong>
        </p>
      )}

      <div>
        <Label htmlFor="password">Nueva contraseña</Label>
        <div className="relative mt-1">
          <Input
            id="password"
            type={showPwd ? "text" : "password"}
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isPending}
            className="pr-10"
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPwd((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            {showPwd ? (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
          </button>
        </div>

        {/* Strength bar */}
        {password && (
          <div className="mt-2 space-y-1">
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    i <= strength.score ? strength.color : "bg-slate-200"
                  }`}
                />
              ))}
            </div>
            <p className={`text-xs ${strength.score <= 2 ? "text-red-600" : strength.score === 3 ? "text-yellow-600" : "text-green-600"}`}>
              {strength.label}
            </p>
          </div>
        )}

        {validationError && (
          <p className="text-xs text-red-600 mt-1">{validationError}</p>
        )}

        <ul className="mt-2 text-xs text-slate-400 space-y-0.5">
          <li className={password.length >= 8 ? "text-green-600" : ""}>✓ Mínimo 8 caracteres</li>
          <li className={/[A-Z]/.test(password) ? "text-green-600" : ""}>✓ Al menos una mayúscula</li>
          <li className={/[0-9]/.test(password) ? "text-green-600" : ""}>✓ Al menos un número</li>
        </ul>
      </div>

      <div>
        <Label htmlFor="confirm">Confirmar contraseña</Label>
        <Input
          id="confirm"
          type={showPwd ? "text" : "password"}
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={isPending}
          className="mt-1"
        />
        {confirm && password !== confirm && (
          <p className="text-xs text-red-600 mt-1">Las contraseñas no coinciden</p>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-sm text-red-700">{error.message}</p>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={!canSubmit}>
        {isPending ? (
          <span className="flex items-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            Guardando...
          </span>
        ) : "Guardar nueva contraseña"}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-white text-sm font-bold">
              R
            </div>
            <CardTitle>Nueva contraseña</CardTitle>
          </div>
          <CardDescription>Elige una contraseña segura para tu cuenta.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<div className="h-52 animate-pulse rounded bg-muted" />}>
            <ResetPasswordForm />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
