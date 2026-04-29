"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type OrgSummary = { id: string; name: string; slug: string };

type OrgContextValue = {
  orgs: OrgSummary[];
  selectedOrgId: string;
  setSelectedOrgId: (id: string) => void;
};

const OrgContext = createContext<OrgContextValue | null>(null);

const STORAGE_KEY = "condominios.selectedOrgId";

export function OrgContextProvider({ orgs, children }: { orgs: OrgSummary[]; children: ReactNode }) {
  const [selectedOrgId, setSelectedOrgIdState] = useState<string>(orgs[0]!.id);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (stored && orgs.some((o) => o.id === stored)) {
      setSelectedOrgIdState(stored);
    }
  }, [orgs]);

  const setSelectedOrgId = (id: string) => {
    setSelectedOrgIdState(id);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id);
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
