import { Decimal } from "decimal.js";

/**
 * Representación de un monto bimonetario.
 * Toda transacción financiera del sistema debe registrar ambas monedas más la tasa aplicada.
 */
export type Money = {
  bss: Decimal;
  usd: Decimal;
  rate: Decimal; // VES por 1 USD al momento del registro
  source: "BCV" | "BINANCE_P2P" | "MANUAL";
};

export type Currency = "VES" | "USD";

/**
 * Convierte un monto en una moneda primaria a Money completo aplicando la tasa.
 * NUNCA redondeamos en pasos intermedios — solo al persistir con .toFixed(2).
 */
export function toMoney(
  amount: Decimal.Value,
  primary: Currency,
  rate: Decimal.Value,
  source: Money["source"] = "BCV",
): Money {
  const r = new Decimal(rate);
  const a = new Decimal(amount);
  if (primary === "USD") {
    return { usd: a, bss: a.mul(r), rate: r, source };
  }
  return { bss: a, usd: a.div(r), rate: r, source };
}

export function formatVes(value: Decimal.Value): string {
  return new Intl.NumberFormat("es-VE", {
    style: "currency",
    currency: "VES",
    minimumFractionDigits: 2,
  }).format(new Decimal(value).toNumber());
}

export function formatUsd(value: Decimal.Value): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(new Decimal(value).toNumber());
}

/**
 * Normaliza un campo Decimal de Prisma a string para comparaciones en tests.
 * En producción superjson+tRPC ya convierte automáticamente, pero en tests unitarios
 * que llaman servicios directamente el campo sigue siendo un objeto Decimal.
 * Usar: expect(decimalToStr(invoice.totalUsd)).toBe("83.34")
 */
export function decimalToStr(value: { toString(): string } | null | undefined): string {
  return value?.toString() ?? "0";
}
