"use client";

/**
 * SearchableSelect — reemplaza <select> nativo con un combobox filtrable.
 * Permite escribir texto para filtrar opciones (ej. "101" → "101A", "B-16").
 * Compatible con el mismo API que <select>: value + onChange.
 *
 * El dropdown se renderiza en un portal (document.body) con position:fixed
 * para que funcione correctamente dentro de modales y diálogos sin ser
 * recortado por overflow:hidden o stacking contexts del contenedor padre.
 */

import { useState, useRef, useEffect, useId, useCallback } from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Texto que aparece cuando no hay opciones que coincidan */
  emptyText?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Seleccionar...",
  disabled = false,
  className = "",
  emptyText = "Sin resultados",
}: SearchableSelectProps) {
  const [open, setOpen]             = useState(false);
  const [query, setQuery]           = useState("");
  const [mounted, setMounted]       = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const inputRef    = useRef<HTMLInputElement>(null);
  const triggerRef  = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const id          = useId();

  // Evita hydration mismatch — portales solo existen en el cliente
  useEffect(() => { setMounted(true); }, []);

  const selected = options.find(o => o.value === value);

  const filtered = query.trim()
    ? options.filter(o =>
        o.label.toLowerCase().includes(query.trim().toLowerCase())
      )
    : options;

  // Calcula la posición del dropdown relativa al trigger
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    // Altura aproximada del dropdown (máx 15 items × 32px + buscador 40px)
    const approxHeight = Math.min(240 + 40, filtered.length * 32 + 40);
    const spaceBelow = viewportHeight - rect.bottom;

    // Si no cabe abajo y hay más espacio arriba → abre hacia arriba
    const showAbove = spaceBelow < approxHeight && rect.top > approxHeight;

    setDropdownStyle({
      position: "fixed",
      top: showAbove ? rect.top - approxHeight - 4 : rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      minWidth: 200,
      zIndex: 99999,
      backgroundColor: "var(--popover, white)",
      border: "1px solid var(--border, #e2e8f0)",
      borderRadius: "0.375rem",
      boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
      overflow: "hidden",
    });
  }, [filtered.length]);

  // Recalcular posición al abrir y al hacer scroll/resize
  useEffect(() => {
    if (!open) return;
    updatePosition();
    setTimeout(() => inputRef.current?.focus(), 50);

    const handleScrollOrResize = () => updatePosition();
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open, updatePosition]);

  // Cerrar al hacer click fuera (trigger o dropdown)
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
      setQuery("");
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleSelect(val: string) {
    onChange(val);
    setOpen(false);
    setQuery("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { setOpen(false); setQuery(""); return; }
    if (e.key === "Enter" && filtered.length > 0) {
      handleSelect(filtered[0]!.value);
    }
  }

  // Dropdown renderizado en portal
  const dropdownEl = open ? (
    <div
      ref={dropdownRef}
      style={dropdownStyle}
      className="overflow-hidden"
    >
      {/* Buscador */}
      <div className="border-b border-border px-2 py-1.5">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Buscar..."
          className="
            w-full bg-transparent text-sm text-foreground
            placeholder:text-muted-foreground focus:outline-none
          "
        />
      </div>

      {/* Lista de opciones */}
      <div className="max-h-60 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">{emptyText}</div>
        ) : (
          filtered.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => handleSelect(o.value)}
              className={`
                w-full text-left px-3 py-1.5 text-sm transition-colors
                hover:bg-accent hover:text-accent-foreground
                ${o.value === value ? "bg-primary/10 text-primary font-medium" : "text-foreground"}
              `}
            >
              {query.trim()
                ? <HighlightMatch text={o.label} query={query.trim()} />
                : o.label
              }
            </button>
          ))
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className={`relative ${className}`} id={id}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen(o => !o); }}
        className={`
          w-full flex items-center justify-between gap-2
          rounded-md border border-input bg-background px-3 py-2
          text-sm text-left shadow-sm transition-colors
          focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1
          disabled:cursor-not-allowed disabled:opacity-50
          ${open ? "border-ring ring-2 ring-ring ring-offset-1" : "hover:bg-accent/30"}
        `}
      >
        <span className={selected ? "text-foreground" : "text-muted-foreground"}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          className={`h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Portal: el dropdown flota sobre TODO el contenido incluyendo modales */}
      {mounted && createPortal(dropdownEl, document.body)}
    </div>
  );
}

/** Resalta en negrita la parte del texto que coincide con la búsqueda */
function HighlightMatch({ text, query }: { text: string; query: string }) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, idx)}
      <strong className="text-primary">{text.slice(idx, idx + query.length)}</strong>
      {text.slice(idx + query.length)}
    </span>
  );
}
