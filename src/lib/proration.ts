import { Decimal } from "decimal.js";

/**
 * Distribuye un monto total `total` entre N participantes según sus alícuotas (porcentajes).
 *
 * Garantías:
 * - La suma de los montos asignados es EXACTAMENTE igual a `total` (sin pérdida ni exceso de centavos).
 * - El reparto es proporcional a la alícuota de cada participante.
 * - Los centavos sobrantes/faltantes se asignan por el método de "largest remainder" (Hamilton):
 *   primero los participantes con mayor parte fraccionaria reciben +/- 0.01.
 * - Si dos participantes empatan en residuo, gana el que tenga mayor alícuota; si también empatan,
 *   gana el que aparece primero en la lista (orden estable).
 *
 * @param total Monto a distribuir (Decimal o number)
 * @param participants Array de { key, aliquot } donde aliquot está en porcentaje (0..100)
 * @param scale Decimales del resultado. Default 2 (centavos).
 * @returns Map<key, Decimal> con el monto exacto asignado a cada participante.
 * @throws Error si la suma de alícuotas no está entre (0, 100] o si total < 0.
 */
export function prorate<K extends string>(
  total: Decimal.Value,
  participants: ReadonlyArray<{ key: K; aliquot: Decimal.Value }>,
  scale = 2,
): Map<K, Decimal> {
  const totalDec = new Decimal(total);
  if (totalDec.lt(0)) throw new Error("prorate: total no puede ser negativo");
  if (participants.length === 0) {
    if (totalDec.eq(0)) return new Map();
    throw new Error("prorate: no hay participantes pero total > 0");
  }

  const sumAliquot = participants.reduce(
    (acc, p) => acc.plus(p.aliquot),
    new Decimal(0),
  );
  if (sumAliquot.lte(0)) throw new Error("prorate: suma de alícuotas debe ser > 0");
  // Toleramos sumas no exactamente iguales a 100 (un edificio puede no tener todas sus unidades creadas).
  // Repartimos proporcionalmente al peso de cada uno respecto a la suma de alícuotas presente.

  const unit = new Decimal(10).pow(-scale); // ej. 0.01 para scale=2
  const result = new Map<K, Decimal>();
  const exact: Array<{ key: K; aliquot: Decimal; floored: Decimal; remainder: Decimal }> = [];

  for (const p of participants) {
    const a = new Decimal(p.aliquot);
    const share = totalDec.mul(a).div(sumAliquot); // share exacta
    const floored = share.toDecimalPlaces(scale, Decimal.ROUND_DOWN);
    const remainder = share.minus(floored);
    result.set(p.key, floored);
    exact.push({ key: p.key, aliquot: a, floored, remainder });
  }

  const sumFloored = exact.reduce((acc, e) => acc.plus(e.floored), new Decimal(0));
  const diff = totalDec.minus(sumFloored); // siempre >= 0 con ROUND_DOWN

  if (diff.eq(0)) return result;

  // Cuántas unidades de "centavo" tenemos que repartir.
  const unitsToDistribute = diff.div(unit).toNumber();
  if (!Number.isFinite(unitsToDistribute) || unitsToDistribute < 0) {
    throw new Error(`prorate: cantidad inesperada a redistribuir: ${diff.toString()}`);
  }

  // Ordenar por mayor residuo desc, luego mayor alícuota desc (estable: orden original como tiebreaker).
  const indexed = exact.map((e, i) => ({ ...e, idx: i }));
  indexed.sort((a, b) => {
    const r = b.remainder.cmp(a.remainder);
    if (r !== 0) return r;
    const al = b.aliquot.cmp(a.aliquot);
    if (al !== 0) return al;
    return a.idx - b.idx;
  });

  const winners = indexed.slice(0, Math.round(unitsToDistribute));
  for (const w of winners) {
    result.set(w.key, result.get(w.key)!.plus(unit));
  }

  return result;
}

/**
 * Prorrateo UNIFORME (decisión cliente 02/jul/2026: "que todos paguen lo mismo y
 * lo que sobre va para anticipo"). A diferencia de `prorate` (Hamilton, suma exacta
 * repartiendo centavos), aquí cada participante recibe `round(total × peso/Σpeso)` a
 * centavo. Así **dos unidades con la misma alícuota pagan EXACTAMENTE lo mismo**. La
 * suma puede quedar unos céntimos por encima/debajo del total — esa diferencia es el
 * "anticipo/sobrante" que absorbe el edificio. Maneja montos negativos (ajustes).
 */
export function prorateUniform<K extends string>(
  total: Decimal.Value,
  participants: ReadonlyArray<{ key: K; aliquot: Decimal.Value }>,
  scale = 2,
): Map<K, Decimal> {
  const totalDec = new Decimal(total);
  const result = new Map<K, Decimal>();
  if (participants.length === 0) return result;
  const sumAliquot = participants.reduce((acc, p) => acc.plus(p.aliquot), new Decimal(0));
  if (sumAliquot.lte(0)) {
    for (const p of participants) result.set(p.key, new Decimal(0));
    return result;
  }
  for (const p of participants) {
    const share = totalDec.mul(new Decimal(p.aliquot)).div(sumAliquot);
    // ROUND_CEIL (hacia +∞): los cargos se redondean hacia arriba y los créditos
    // hacia cero → el edificio SIEMPRE queda con un pequeño sobrante (anticipo),
    // nunca en déficit. Todos con la misma alícuota pagan idéntico.
    result.set(p.key, share.toDecimalPlaces(scale, Decimal.ROUND_CEIL));
  }
  return result;
}

/**
 * Helper: dada una distribución, valida que la suma sea exactamente el total esperado.
 * Útil en tests y como guard antes de persistir.
 */
export function assertSumExact<K extends string>(
  result: Map<K, Decimal>,
  expectedTotal: Decimal.Value,
): void {
  const sum = [...result.values()].reduce((acc, v) => acc.plus(v), new Decimal(0));
  const expected = new Decimal(expectedTotal);
  if (!sum.eq(expected)) {
    throw new Error(
      `Prorrateo no cuadra: suma=${sum.toString()} vs total=${expected.toString()}`,
    );
  }
}
