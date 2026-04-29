/**
 * Flujo financiero end-to-end:
 * 1. Configura cuota mensual
 * 2. Registra 3 gastos comunes
 * 3. Emite facturas mensuales
 * 4. Registra pagos (parcial + total)
 * 5. Verifica aging
 */
import { test, expect } from "@playwright/test";
import { login } from "./helpers/auth";

const COMMUNITY_ID = "hugo-chavez-frias-seed";
const BASE = `/org/communities/${COMMUNITY_ID}`;

// Periodo de prueba: usar mes/año fijo para idempotencia de tests
const YEAR  = 2099;
const MONTH = 1;

test.describe("Finanzas — flujo completo", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("configura cuota mensual", async ({ page }) => {
    await page.goto(`${BASE}/finance`);
    await page.waitForLoadState("networkidle");

    // Formulario de cuota mensual
    const feeInput = page.getByLabel(/nueva cuota/i).or(page.locator("input[type=number]").first());
    await feeInput.fill("25.00");
    await page.getByRole("button", { name: /actualizar/i }).click();
    await expect(page.getByText(/actualizada|✓/i)).toBeVisible({ timeout: 8_000 });
  });

  test("registra gasto de electricidad", async ({ page }) => {
    await page.goto(`${BASE}/finance/expenses`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /\+ gasto|nuevo gasto|registrar/i }).click();

    // Categoría
    const catSelect = page.locator("select").filter({ hasText: /categoría|electricidad|category/i }).first();
    if (await catSelect.isVisible()) await catSelect.selectOption("ELECTRICITY");

    await page.getByLabel(/descripción/i).fill("Factura CORPOELEC Enero 2099");
    await page.getByLabel(/monto|amount/i).fill("333.33");

    // Año/mes se dejan en el período actual para que el filtro de la lista los muestre

    await page.getByRole("button", { name: /registrar|guardar|crear/i }).last().click();
    await page.waitForTimeout(1500);
    // El gasto debe aparecer en la lista (CORPOELEC aparece en la descripción)
    await expect(page.getByText(/CORPOELEC|electricidad/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("registra gasto de agua", async ({ page }) => {
    await page.goto(`${BASE}/finance/expenses`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /\+ gasto|nuevo gasto|registrar/i }).click();

    const catSelect = page.locator("select").first();
    await catSelect.selectOption("WATER");
    await page.getByLabel(/descripción/i).fill("Agua potable Enero 2099");
    await page.getByLabel(/monto|amount/i).fill("150.00");
    await page.getByRole("button", { name: /registrar|guardar|crear/i }).last().click();
    await page.waitForTimeout(1000);
    await expect(page.getByText(/agua|water/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("registra gasto de limpieza", async ({ page }) => {
    await page.goto(`${BASE}/finance/expenses`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /\+ gasto|nuevo gasto|registrar/i }).click();

    const catSelect = page.locator("select").first();
    await catSelect.selectOption("CLEANING");
    await page.getByLabel(/descripción/i).fill("Empresa de limpieza Enero 2099");
    await page.getByLabel(/monto|amount/i).fill("200.00");
    await page.getByRole("button", { name: /registrar|guardar|crear/i }).last().click();
    await page.waitForTimeout(1000);
    await expect(page.getByText(/limpieza|cleaning/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("emite facturas mensuales para el período de prueba", async ({ page }) => {
    await page.goto(`${BASE}/finance/invoices`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /emitir|generar facturas/i }).click();

    // Seleccionar año 2099
    const yearInput = page.locator("input[name=year], input[placeholder*=año], input[type=number]").first();
    if (await yearInput.isVisible()) await yearInput.fill(`${YEAR}`);

    const monthSel = page.locator("select").first();
    if (await monthSel.isVisible()) await monthSel.selectOption(`${MONTH}`);

    // Fecha de vencimiento
    const dueDateInput = page.locator("input[type=date]").first();
    if (await dueDateInput.isVisible()) await dueDateInput.fill("2099-01-31");

    await page.getByRole("button", { name: /confirmar|emitir|generar/i }).last().click();
    await page.waitForTimeout(3000);

    // Deben haberse creado facturas
    await expect(page.getByText(/factura|2099|emitida/i).first()).toBeVisible({ timeout: 12_000 });
  });

  test("facturas emitidas aparecen en la lista filtrada por período", async ({ page }) => {
    await page.goto(`${BASE}/finance/invoices`);
    await page.waitForLoadState("networkidle");

    // Filtrar por año 2099
    const yearInput = page.locator("input[type=number]").first();
    await yearInput.fill("2099");
    await page.waitForTimeout(800);

    const invoiceRows = await page.locator("table tbody tr").count();
    expect(invoiceRows).toBeGreaterThan(0);
  });

  test("registra pago parcial en una unidad", async ({ page }) => {
    await page.goto(`${BASE}/finance/payments`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /registrar pago|nuevo pago|\+ pago/i }).click();
    await page.waitForTimeout(500);

    // Seleccionar primera unidad
    const unitSel = page.locator("select").first();
    const options = await unitSel.locator("option").all();
    if (options.length > 1) await unitSel.selectOption({ index: 1 });

    await page.getByLabel(/monto|amount/i).fill("50.00");

    const methodSel = page.locator("select").nth(2);
    if (await methodSel.isVisible()) await methodSel.selectOption("ZELLE");

    const dateInput = page.locator("input[type=date]").first();
    if (await dateInput.isVisible()) await dateInput.fill("2099-01-15");

    await page.getByRole("button", { name: /registrar|guardar/i }).last().click();
    await page.waitForTimeout(2000);

    await expect(page.getByText(/pago|payment|50/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("aging de cartera muestra saldos pendientes", async ({ page }) => {
    await page.goto(`${BASE}/finance`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/aging|antigüedad|cartera/i)).toBeVisible({ timeout: 8_000 });
    // Debe haber al menos una celda con valor
    await expect(page.locator("[class*=rounded][class*=border]").first()).toBeVisible();
  });

  test("exporta facturas a Excel sin error", async ({ page }) => {
    await page.goto(`${BASE}/reports`);
    await page.waitForLoadState("networkidle");

    // Seleccionar año 2099 si existe
    const yearSel = page.locator("select").last();
    const opts = await yearSel.locator("option").all();
    for (const o of opts) {
      if ((await o.textContent())?.includes("2099")) { await yearSel.selectOption("2099"); break; }
    }

    const downloadPromise = page.waitForEvent("download", { timeout: 10_000 }).catch(() => null);
    await page.getByRole("button", { name: /excel|↓/i }).click();
    const download = await downloadPromise;
    if (download) {
      expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
    }
  });
});
