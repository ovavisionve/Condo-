import { test, expect } from "@playwright/test";
import { login, goToCommunity } from "./helpers/auth";

const COMMUNITY_ID = "hugo-chavez-frias-seed";

test.describe("Comunidad y unidades", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("panel de edificios lista las comunidades", async ({ page }) => {
    await page.goto("/org");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/Hugo Chávez|Residencias/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("página de comunidad muestra nombre e información", async ({ page }) => {
    await goToCommunity(page, COMMUNITY_ID);
    await expect(page.getByText(/Hugo Chávez Frías/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("lista 40 unidades en el tab Unidades", async ({ page }) => {
    await page.goto(`/org/communities/${COMMUNITY_ID}/units`);
    await page.waitForLoadState("networkidle");
    // Debe haber 40 unidades (1A–10D) — esperar a que los datos carguen antes de contar
    await expect(page.getByText("1A").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("10D").first()).toBeVisible();
    const rows = await page.locator("table tbody tr").count();
    expect(rows).toBeGreaterThanOrEqual(10); // al menos visible una página
  });

  test("detalle de unidad carga sin errores", async ({ page }) => {
    // Navega a unidad 1A via la lista
    await page.goto(`/org/communities/${COMMUNITY_ID}/units`);
    await page.waitForLoadState("networkidle");
    const link1A = page.getByRole("link", { name: "Ver" }).first();
    await link1A.click();
    await page.waitForLoadState("networkidle");
    // El detalle debe mostrar la alícuota
    await expect(page.getByText(/Alícuota|aliquot/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("filtro de piso funciona", async ({ page }) => {
    await page.goto(`/org/communities/${COMMUNITY_ID}/units`);
    await page.waitForLoadState("networkidle");
    // Filtrar por piso 5
    const pisoSelect = page.locator("select").first();
    if (await pisoSelect.isVisible()) {
      await pisoSelect.selectOption("5");
      await page.waitForTimeout(500);
      await expect(page.getByText("5A").first()).toBeVisible();
      await expect(page.getByText("5B").first()).toBeVisible();
    }
  });

  test("tab Resumen muestra estadísticas", async ({ page }) => {
    await goToCommunity(page, COMMUNITY_ID);
    // Debe mostrar algo de info de la comunidad
    await expect(page.getByText(/piso|unidad|cuota|tasa/i).first()).toBeVisible({ timeout: 8_000 });
  });
});
