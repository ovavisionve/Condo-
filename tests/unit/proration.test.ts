import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { prorate, assertSumExact } from "@/lib/proration";

describe("prorate", () => {
  it("reparto exacto cuando alícuotas y total son redondos", () => {
    const r = prorate(100, [
      { key: "A", aliquot: 25 },
      { key: "B", aliquot: 25 },
      { key: "C", aliquot: 50 },
    ]);
    expect(r.get("A")!.toString()).toBe("25");
    expect(r.get("B")!.toString()).toBe("25");
    expect(r.get("C")!.toString()).toBe("50");
    assertSumExact(r, 100);
  });

  it("reparto con centavo sobrante: largest remainder", () => {
    // 100 entre 3 partes iguales -> 33.33, 33.33, 33.34
    const r = prorate(100, [
      { key: "A", aliquot: "33.333333" },
      { key: "B", aliquot: "33.333333" },
      { key: "C", aliquot: "33.333334" },
    ]);
    assertSumExact(r, 100);
    // El de mayor alícuota recibe el centavo extra (resolución de empate)
    expect(r.get("C")!.toString()).toBe("33.34");
  });

  it("suma siempre exacta con valores irregulares", () => {
    // Caso real: gasto de 1234.56 entre 7 unidades con alícuotas distintas
    const r = prorate(new Decimal("1234.56"), [
      { key: "A1", aliquot: "14.2857" },
      { key: "A2", aliquot: "14.2857" },
      { key: "A3", aliquot: "14.2857" },
      { key: "A4", aliquot: "14.2857" },
      { key: "A5", aliquot: "14.2857" },
      { key: "A6", aliquot: "14.2857" },
      { key: "A7", aliquot: "14.2858" },
    ]);
    assertSumExact(r, "1234.56");
  });

  it("suma exacta cuando alícuotas no suman 100 (unidades faltantes)", () => {
    // Solo 90% de las alícuotas registradas: el reparto se ajusta a esos 90%
    const r = prorate(900, [
      { key: "A", aliquot: 30 },
      { key: "B", aliquot: 60 },
    ]);
    assertSumExact(r, 900);
    expect(r.get("A")!.toString()).toBe("300");
    expect(r.get("B")!.toString()).toBe("600");
  });

  it("monto cero: todos reciben cero", () => {
    const r = prorate(0, [
      { key: "A", aliquot: 50 },
      { key: "B", aliquot: 50 },
    ]);
    expect(r.get("A")!.toString()).toBe("0");
    expect(r.get("B")!.toString()).toBe("0");
  });

  it("alta precisión: 4 decimales para tasas de cambio", () => {
    const r = prorate("1.0000", [
      { key: "A", aliquot: 33.3333 },
      { key: "B", aliquot: 33.3333 },
      { key: "C", aliquot: 33.3334 },
    ], 4);
    assertSumExact(r, "1.0000");
  });

  it("rechaza total negativo", () => {
    expect(() => prorate(-1, [{ key: "A", aliquot: 100 }])).toThrow();
  });

  it("rechaza alícuotas todas en cero", () => {
    expect(() =>
      prorate(100, [
        { key: "A", aliquot: 0 },
        { key: "B", aliquot: 0 },
      ]),
    ).toThrow();
  });

  it("muchas unidades, monto difícil: la suma SIEMPRE cuadra", () => {
    const N = 50;
    const participants = Array.from({ length: N }, (_, i) => ({
      key: `U${i}` as const,
      aliquot: new Decimal(100).div(N),
    }));
    for (const total of ["7777.77", "0.03", "1000000.01", "99.99", "1.23"]) {
      const r = prorate(total, participants);
      assertSumExact(r, total);
    }
  });
});
