/**
 * Flujo E2E — Reportes y Dashboard
 */
import { test, expect } from "@playwright/test";
import { login } from "./helpers/auth";

const COMMUNITY_ID = "hugo-chavez-frias-seed";
const BASE = `/org/communities/${COMMUNITY_ID}`;

test.describe("Reportes y Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("dashboard de reportes carga sin errores", async ({ page }) => {
    await page.goto(`${BASE}/reports`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/reportes|dashboard/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("KPI cards se renderizan", async ({ page }) => {
    await page.goto(`${BASE}/reports`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/facturado/i).first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/cobrado/i).first()).toBeVisible();
    await expect(page.getByText(/pendiente/i).first()).toBeVisible();
    await expect(page.getByText(/unidades/i).first()).toBeVisible();
  });

  test("selector de período mensual/trimestral/semestral existe", async ({ page }) => {
    await page.goto(`${BASE}/reports`);
    await page.waitForLoadState("networkidle");
    const periodSel = page.locator("select").first();
    await expect(periodSel).toBeVisible({ timeout: 5_000 });
    const opts = await periodSel.locator("option").allTextContents();
    expect(opts.some(o => /mensual/i.test(o))).toBeTruthy();
    expect(opts.some(o => /trimestral/i.test(o))).toBeTruthy();
    expect(opts.some(o => /semestral/i.test(o))).toBeTruthy();
  });

  test("reporte trimestral muestra KPIs consolidados", async ({ page }) => {
    await page.goto(`${BASE}/reports`);
    await page.waitForLoadState("networkidle");

    const periodSel = page.locator("select").first();
    await periodSel.selectOption("quarterly");
    await page.waitForTimeout(1000);

    await expect(page.getByText(/gastos/i).first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/balance neto/i)).toBeVisible();
  });

  test("reporte semestral muestra KPIs consolidados", async ({ page }) => {
    await page.goto(`${BASE}/reports`);
    await page.waitForLoadState("networkidle");

    const periodSel = page.locator("select").first();
    await periodSel.selectOption("semiannual");
    await page.waitForTimeout(1000);

    await expect(page.getByText(/reporte semestral/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("gráfica de tendencia 12 meses se renderiza", async ({ page }) => {
    await page.goto(`${BASE}/reports`);
    await page.waitForLoadState("networkidle");
    // recharts renderiza un SVG
    await expect(page.locator("svg").first()).toBeVisible({ timeout: 10_000 });
  });

  test("sección aging de cartera aparece en reportes", async ({ page }) => {
    await page.goto(`${BASE}/reports`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/aging|antigüedad/i)).toBeVisible({ timeout: 8_000 });
  });

  test("tabla top deudores se renderiza", async ({ page }) => {
    await page.goto(`${BASE}/reports`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/top deudores|deudor/i)).toBeVisible({ timeout: 8_000 });
  });

  test("aging en página de finanzas muestra 5 buckets", async ({ page }) => {
    await page.goto(`${BASE}/finance`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/por vencer|0-30/i).first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/31-60/i)).toBeVisible();
    await expect(page.getByText(/61-90/i)).toBeVisible();
    await expect(page.getByText(/90\+/i)).toBeVisible();
  });

  test("estado de cuenta de unidad muestra facturas y pagos", async ({ page }) => {
    await page.goto(`${BASE}/finance/account`);
    await page.waitForLoadState("networkidle");
    // Seleccionar una unidad
    const unitSel = page.locator("select").first();
    const opts = await unitSel.locator("option").all();
    if (opts.length > 1) {
      await unitSel.selectOption({ index: 1 });
      await page.waitForTimeout(1000);
      await expect(page.locator("table, [class*=card]").first()).toBeVisible({ timeout: 8_000 });
    }
  });
});
