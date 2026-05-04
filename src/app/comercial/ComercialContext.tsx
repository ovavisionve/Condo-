"use client";

import { createContext, useContext, useLayoutEffect, useState } from "react";

type OrgOption = { id: string; name: string; slug: string };

const STORAGE_KEY = "cc_selectedOrgId";

interface ComercialContextValue {
  orgs: OrgOption[];
  selectedOrgId: string;
  setSelectedOrgId: (id: string) => void;
  selectedOrg: OrgOption;
}

const ComercialContext = createContext<ComercialContextValue | null>(null);

export function ComercialContextProvider({
  orgs,
  children,
}: {
  orgs: OrgOption[];
  children: React.ReactNode;
}) {
  const [selectedOrgId, setSelectedOrgIdState] = useState<string>(orgs[0]!.id);

  // Restaurar desde localStorage sincrónicamente antes del primer paint
  useLayoutEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && orgs.some((o) => o.id === saved)) {
        setSelectedOrgIdState(saved);
      }
    } catch {
      // SSR / privado
    }
  }, [orgs]);

  const setSelectedOrgId = (id: string) => {
    setSelectedOrgIdState(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
  };

  const selectedOrg = orgs.find((o) => o.id === selectedOrgId) ?? orgs[0]!;

  return (
    <ComercialContext.Provider value={{ orgs, selectedOrgId, setSelectedOrgId, selectedOrg }}>
      {children}
    </ComercialContext.Provider>
  );
}

export function useComercial() {
  const ctx = useContext(ComercialContext);
  if (!ctx) throw new Error("useComercial debe usarse dentro de ComercialContextProvider");
  return ctx;
}
