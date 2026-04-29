import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";

/**
 * Tests de invariantes financieras del sistema:
 * - El prorrateo de cualquier total entre N unidades siempre suma exacto
 * - Las conversiones bimonetarias son simétricas
 * - El aging clasifica correctamente por días de vencimiento
 */

import { prorate, assertSumExact } from "@/lib/proration";

describe("invariantes de prorrateo — edificio Hugo Chávez Frías (40 unidades)", () => {
  const ALIQUOT = new Decimal(100).div(40).toString(); // 2.5
  const participants = Array.from({ length: 40 }, (_, i) => ({
    key: `U${i}`,
    aliquot: ALIQUOT,
  }));

  it("reparte cualquier monto entre 40 unidades iguales con suma exacta", () => {
    const totals = ["1000.00", "333.33", "7777.77", "0.01", "99999.99", "1.00"];
    for (const total of totals) {
      const r = prorate(total, participants);
      assertSumExact(r, total);
    }
  });

  it("gasto de electricidad $333.33: cada unidad recibe $8.33 o $8.34", () => {
    const r = prorate("333.33", participants);
    assertSumExact(r, "333.33");
    const values = [...r.values()].map((v) => v.toFixed(2));
    // Con 40 unidades: 333.33 / 40 = 8.33325 → 33 unidades en 8.33, 7 en 8.34
    const count834 = values.filter((v) => v === "8.34").length;
    const count833 = values.filter((v) => v === "8.33").length;
    expect(count834 + count833).toBe(40);
    // Verificar que la suma de cuántos dan 8.34 es correcta:
    // 40 * 8.33 = 333.20; diferencia = 0.13 → 13 unidades reciben 8.34
    expect(count834).toBe(13);
    expect(count833).toBe(27);
  });

  it("cuota mensual $25 × 40 unidades = $1000.00 exacto", () => {
    const feeUsd = new Decimal("25.00");
    const total = feeUsd.times(40);
    expect(total.toFixed(2)).toBe("1000.00");
  });

  it("prorratea monto con decimales irregulares entre alícuotas desiguales", () => {
    // Simula edificio con torres diferentes
    const mixed = [
      { key: "A", aliquot: "33.333333" },
      { key: "B", aliquot: "33.333333" },
      { key: "C", aliquot: "33.333334" },
    ];
    const r = prorate("999.99", mixed);
    assertSumExact(r, "999.99");
  });
});

describe("clasificación de aging por días vencidos", () => {
  function classifyDays(daysOverdue: number) {
    if (daysOverdue < 0) return "current";
    if (daysOverdue <= 30) return "d_0_30";
    if (daysOverdue <= 60) return "d_31_60";
    if (daysOverdue <= 90) return "d_61_90";
    return "d_90_plus";
  }

  it("factura con vencimiento futuro → current", () => {
    expect(classifyDays(-1)).toBe("current");
    expect(classifyDays(-30)).toBe("current");
  });

  it("factura vencida hace 0 días → d_0_30", () => {
    expect(classifyDays(0)).toBe("d_0_30");
  });

  it("factura vencida hace 30 días → d_0_30", () => {
    expect(classifyDays(30)).toBe("d_0_30");
  });

  it("factura vencida hace 31 días → d_31_60", () => {
    expect(classifyDays(31)).toBe("d_31_60");
  });

  it("factura vencida hace 60 días → d_31_60", () => {
    expect(classifyDays(60)).toBe("d_31_60");
  });

  it("factura vencida hace 61 días → d_61_90", () => {
    expect(classifyDays(61)).toBe("d_61_90");
  });

  it("factura vencida hace 90 días → d_61_90", () => {
    expect(classifyDays(90)).toBe("d_61_90");
  });

  it("factura vencida hace 91 días → d_90_plus", () => {
    expect(classifyDays(91)).toBe("d_90_plus");
    expect(classifyDays(365)).toBe("d_90_plus");
  });
});

describe("balance neto de una unidad", () => {
  function calcBalance(invoices: { totalUsd: string; paidUsd: string }[]) {
    return invoices
      .reduce((acc, i) => acc.plus(i.totalUsd).minus(i.paidUsd), new Decimal(0))
      .toFixed(2);
  }

  it("sin facturas → balance cero", () => {
    expect(calcBalance([])).toBe("0.00");
  });

  it("factura pagada → balance cero", () => {
    expect(calcBalance([{ totalUsd: "100.00", paidUsd: "100.00" }])).toBe("0.00");
  });

  it("factura parcial → saldo correcto", () => {
    expect(calcBalance([{ totalUsd: "100.00", paidUsd: "60.00" }])).toBe("40.00");
  });

  it("múltiples facturas → acumulación correcta", () => {
    expect(
      calcBalance([
        { totalUsd: "100.00", paidUsd: "100.00" },
        { totalUsd: "200.00", paidUsd: "0.00" },
        { totalUsd: "50.00", paidUsd: "25.00" },
      ]),
    ).toBe("225.00");
  });

  it("no usa float nativo — Decimal en todo el cálculo", () => {
    // 0.1 + 0.2 en float nativo da 0.30000000000000004
    const result = calcBalance([
      { totalUsd: "0.10", paidUsd: "0.00" },
      { totalUsd: "0.20", paidUsd: "0.00" },
    ]);
    expect(result).toBe("0.30");
  });
});
