"use client";

import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";

type OrgSummary = { id: string; name: string; slug: string };

type OrgContextValue = {
  orgs: OrgSummary[];
  selectedOrgId: string;
  setSelectedOrgId: (id: string) => void;
};

const OrgContext = createContext<OrgContextValue | null>(null);

// sessionStorage → cada pestaña es independiente (no se sincronizan entre tabs)
// localStorage → persiste al cerrar el navegador pero se comparte entre todas las pestañas
const SESSION_KEY = "condominios.selectedOrgId";
const LOCAL_KEY   = "condominios.selectedOrgId.last";

export function OrgContextProvider({ orgs, children }: { orgs: OrgSummary[]; children: ReactNode }) {
  const [selectedOrgId, setSelectedOrgIdState] = useState<string>(orgs[0]!.id);

  // useLayoutEffect corre sincrónicamente antes del primer paint del browser,
  // así los queries de tRPC nunca arrancan con el organizationId incorrecto.
  // Prioridad: sessionStorage (pestaña actual) → localStorage (última sesión) → primer org
  useLayoutEffect(() => {
    const session = sessionStorage.getItem(SESSION_KEY);
    const local   = localStorage.getItem(LOCAL_KEY);
    const stored  = session ?? local;
    if (stored && orgs.some((o) => o.id === stored)) {
      setSelectedOrgIdState(stored);
      // Asegurar que sessionStorage tiene el valor para esta pestaña
      if (!session) sessionStorage.setItem(SESSION_KEY, stored);
    }
  }, [orgs]);

  const setSelectedOrgId = (id: string) => {
    setSelectedOrgIdState(id);
    // sessionStorage: solo afecta esta pestaña
    sessionStorage.setItem(SESSION_KEY, id);
    // localStorage: recuerda la última usada para nuevas pestañas/ventanas
    localStorage.setItem(LOCAL_KEY, id);
  };

  return (
    <OrgContext.Provider value={{ orgs, selectedOrgId, setSelectedOrgId }}>
      <div className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-2 text-sm">
          <span className="text-muted-foreground">Organización:</span>
          {orgs.length === 1 ? (
            <strong>{orgs[0]!.name}</strong>
          ) : (
            <select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className="rounded border bg-background px-2 py-1"
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrgId(): string {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrgId fuera de OrgContextProvider");
  return ctx.selectedOrgId;
}

export function useOrgs(): { orgs: OrgSummary[]; selectedOrgId: string; setSelectedOrgId: (id: string) => void } {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrgs fuera de OrgContextProvider");
  return ctx;
}
