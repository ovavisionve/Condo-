/**
 * Flujo E2E — Seguridad y acceso:
 * visitante pre-autorizado → check-in → check-out
 * registro manual (walk-in)
 * reporte de violación → multa
 */
import { test, expect } from "@playwright/test";
import { login } from "./helpers/auth";

const COMMUNITY_ID = "hugo-chavez-frias-seed";
const BASE = `/org/communities/${COMMUNITY_ID}/security`;

test.describe("Seguridad y acceso", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("página de seguridad carga con 3 tabs", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: /visitantes/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /log de accesos/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /violaciones/i })).toBeVisible();
  });

  test("pre-autoriza un visitante", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /pre-autorizar/i }).click();
    await page.waitForTimeout(500);

    await page.getByLabel(/nombre/i).first().fill("Carlos");
    await page.getByLabel(/apellido/i).fill("García");
    await page.getByLabel(/cédula|idNumber/i).fill("12345678");

    // Seleccionar unidad
    const unitSel = page.locator("select").first();
    const opts = await unitSel.locator("option").all();
    if (opts.length > 1) await unitSel.selectOption({ index: 1 });

    const today = new Date().toISOString().slice(0, 10);
    const inputs = await page.locator("input[type=date]").all();
    for (const inp of inputs.slice(0, 2)) await inp.fill(today);

    await page.getByLabel(/motivo/i).fill("Reparación de plomería");

    await page.getByRole("button", { name: /pre-autorizar/i }).last().click();
    await page.waitForTimeout(2000);

    await expect(page.getByText(/Carlos/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("check-in de visitante pendiente", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    // Busca el botón de Ingreso en cualquier fila pendiente
    const ingresoBtn = page.getByRole("button", { name: /ingreso/i }).first();
    if (await ingresoBtn.isVisible({ timeout: 3_000 })) {
      await ingresoBtn.click();
      await page.waitForTimeout(1500);
      await expect(page.getByText(/adentro|checked.in/i).first()).toBeVisible({ timeout: 8_000 });
    } else {
      test.skip(); // No hay visitantes pendientes, skip
    }
  });

  test("check-out de visitante dentro", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    const salidaBtn = page.getByRole("button", { name: /salida/i }).first();
    if (await salidaBtn.isVisible({ timeout: 3_000 })) {
      await salidaBtn.click();
      await page.waitForTimeout(1500);
      await expect(page.getByText(/salió|checked.out/i).first()).toBeVisible({ timeout: 8_000 });
    } else {
      test.skip();
    }
  });

  test("registra acceso walk-in manual", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    // Ir al tab de log de accesos
    await page.getByRole("button", { name: /log de accesos/i }).click();
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: /registro manual/i }).click();
    await page.waitForTimeout(400);

    await page.getByLabel(/nombre completo/i).fill("Pedro Martínez");
    await page.getByLabel(/cédula/i).fill("87654321");
    await page.getByLabel(/motivo/i).fill("Delivery");

    await page.getByRole("button", { name: /registrar/i }).last().click();
    await page.waitForTimeout(1500);

    await expect(page.getByText(/Pedro Martínez/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("reporta violación de mal uso del ascensor", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /violaciones/i }).click();
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: /reportar violación/i }).click();
    await page.waitForTimeout(400);

    // Seleccionar unidad
    const unitSel = page.locator("select").first();
    const opts = await unitSel.locator("option").all();
    if (opts.length > 1) await unitSel.selectOption({ index: 1 });

    // Tipo: ya está en ELEVATOR_MISUSE por defecto
    await page.getByLabel(/descripción/i).fill("Uso del ascensor sin agua activa — testigo vigilante");

    await page.getByRole("button", { name: /reportar/i }).last().click();
    await page.waitForTimeout(2000);

    await expect(page.getByText(/ascensor|elevator/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("aplica multa a una violación registrada", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /violaciones/i }).click();
    await page.waitForTimeout(500);

    // Buscar botón "+ Multa"
    const multaBtn = page.getByRole("button", { name: /\+ multa/i }).first();
    if (await multaBtn.isVisible({ timeout: 3_000 })) {
      await multaBtn.click();
      await page.waitForTimeout(400);

      const amountInput = page.locator("input[type=number]").first();
      await amountInput.fill("10.00");

      const dueDateInput = page.locator("input[type=date]").first();
      const future = new Date(); future.setDate(future.getDate() + 7);
      await dueDateInput.fill(future.toISOString().slice(0, 10));

      await page.getByRole("button", { name: "✓" }).click();
      await page.waitForTimeout(2000);

      // La multa debe aparecer como número de factura
      await expect(page.getByText(/MULTA/i).first()).toBeVisible({ timeout: 8_000 });
    } else {
      test.skip(); // Sin violaciones sin multa todavía
    }
  });

  test("log de accesos filtra por fecha de hoy", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /log de accesos/i }).click();
    await page.waitForTimeout(500);

    const today = new Date().toISOString().slice(0, 10);
    const dateInput = page.locator("input[type=date]").first();
    await dateInput.fill(today);
    await page.waitForTimeout(800);

    // No debe haber error
    await expect(page.locator("table")).toBeVisible({ timeout: 5_000 });
  });
});
