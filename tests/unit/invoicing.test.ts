import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { buildBimonetary } from "@/server/services/invoicing";

describe("buildBimonetary", () => {
  const RATE = "36.50";

  it("primaria USD: calcula BsS correctamente", () => {
    const r = buildBimonetary("100.00", "USD", RATE);
    expect(r.amountUsd.toString()).toBe("100");
    expect(r.amountBss.toFixed(2)).toBe("3650.00");
    expect(r.rate.toFixed(2)).toBe(RATE);
  });

  it("primaria VES: calcula USD correctamente", () => {
    const r = buildBimonetary("3650.00", "VES", RATE);
    expect(r.amountBss.toString()).toBe("3650");
    expect(r.amountUsd.toFixed(2)).toBe("100.00");
  });

  it("nunca usa float nativo — Decimal en todo", () => {
    const r = buildBimonetary("1.23", "USD", "36.4567");
    expect(r.amountBss instanceof Decimal).toBe(true);
    expect(r.amountUsd instanceof Decimal).toBe(true);
    expect(r.rate instanceof Decimal).toBe(true);
  });

  it("monto cero devuelve ceros en ambas monedas", () => {
    const r = buildBimonetary("0", "USD", RATE);
    expect(r.amountUsd.isZero()).toBe(true);
    expect(r.amountBss.isZero()).toBe(true);
  });

  it("no pierde precisión con tasas de 8 decimales", () => {
    const r = buildBimonetary("1", "USD", "36.12345678");
    expect(r.amountBss.toFixed(8)).toBe("36.12345678");
  });

  it("VES a USD con tasa irregular no pierde centavos", () => {
    // 100 BsS a tasa 36.50 = 2.739726... USD
    const r = buildBimonetary("100", "VES", "36.50");
    // No debe ser exactamente 2.74 por pérdida de float
    expect(new Decimal(r.amountUsd).times("36.50").toFixed(2)).toBe("100.00");
  });
});
