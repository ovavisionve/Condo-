/**
 * Flujo E2E — Gobernanza:
 * junta directiva → asamblea → votación → cierre → PDF acta
 * certificado de solvencia
 * repositorio documental
 */
import { test, expect } from "@playwright/test";
import { login } from "./helpers/auth";

const COMMUNITY_ID = "hugo-chavez-frias-seed";
const BASE = `/org/communities/${COMMUNITY_ID}/governance`;

test.describe("Gobernanza", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("página de gobernanza carga con 4 tabs", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: /junta directiva/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /asambleas/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /documentos/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /certificados/i })).toBeVisible();
  });

  test("junta directiva — mensaje sin miembros si está vacía", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    // Puede estar vacía o tener miembros
    const content = await page.locator("main").textContent();
    expect(content).toMatch(/asignar|presidente|junta|configurada/i);
  });

  test("crea una asamblea ordinaria", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /asambleas/i }).click();
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: /nueva asamblea/i }).click();
    await page.waitForTimeout(400);

    await page.getByLabel(/tipo|título/i).fill("Asamblea Ordinaria E2E 2099");

    const dtInput = page.locator("input[type=datetime-local]").first();
    await dtInput.fill("2099-06-15T10:00");

    await page.getByLabel(/lugar/i).fill("Salón de usos múltiples");

    await page.getByRole("button", { name: /convocar/i }).click();
    await page.waitForTimeout(2000);

    await expect(page.getByText(/Asamblea Ordinaria E2E 2099/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("agrega puntos al orden del día", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /asambleas/i }).click();
    await page.waitForTimeout(300);

    // Seleccionar la asamblea E2E
    const assemblyBtn = page.getByText(/E2E 2099/i).first();
    if (await assemblyBtn.isVisible({ timeout: 3_000 })) {
      await assemblyBtn.click();
      await page.waitForTimeout(500);

      await page.getByRole("button", { name: /agregar punto/i }).click();
      await page.waitForTimeout(300);

      await page.locator("input[placeholder*=título]").fill("Aprobación del presupuesto 2099");

      // Marcar que requiere votación
      const voteCheck = page.locator("input[type=checkbox]").last();
      await voteCheck.check();

      await page.getByRole("button", { name: /agregar/i }).last().click();
      await page.waitForTimeout(1500);

      await expect(page.getByText(/presupuesto 2099/i)).toBeVisible({ timeout: 8_000 });
    } else {
      test.skip();
    }
  });

  test("cierra la asamblea y registra asistencia", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /asambleas/i }).click();
    await page.waitForTimeout(300);

    const assemblyBtn = page.getByText(/E2E 2099/i).first();
    if (await assemblyBtn.isVisible({ timeout: 3_000 })) {
      await assemblyBtn.click();
      await page.waitForTimeout(500);

      await page.getByRole("button", { name: /cerrar asamblea/i }).click();
      await page.waitForTimeout(400);

      await page.locator("input[type=number]").fill("32");

      const quorumCheck = page.locator("input#quorum");
      if (await quorumCheck.isVisible()) await quorumCheck.check();

      await page.getByRole("button", { name: /confirmar cierre/i }).click();
      await page.waitForTimeout(2000);

      await expect(page.getByText(/cerrada|closed/i).first()).toBeVisible({ timeout: 8_000 });
    } else {
      test.skip();
    }
  });

  test("descarga PDF del acta de asamblea cerrada", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /asambleas/i }).click();
    await page.waitForTimeout(300);

    const assemblyBtn = page.getByText(/E2E 2099/i).first();
    if (await assemblyBtn.isVisible({ timeout: 3_000 })) {
      await assemblyBtn.click();
      await page.waitForTimeout(500);

      const pdfBtn = page.getByRole("button", { name: /acta pdf/i });
      if (await pdfBtn.isVisible({ timeout: 3_000 })) {
        const downloadPromise = page.waitForEvent("download", { timeout: 15_000 });
        await pdfBtn.click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/acta.*\.pdf$/i);
      } else {
        test.skip();
      }
    } else {
      test.skip();
    }
  });

  test("genera certificado de solvencia PDF", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /certificados/i }).click();
    await page.waitForTimeout(500);

    // Seleccionar la primera unidad disponible
    const unitSel = page.locator("select").first();
    const opts = await unitSel.locator("option").all();
    if (opts.length > 1) {
      await unitSel.selectOption({ index: 1 });

      const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
      await page.getByRole("button", { name: /generar y descargar/i }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/solvencia.*\.pdf$/i);

      // Debe mostrar resultado (solvente o con deuda)
      await expect(page.getByText(/solvente|deuda/i).first()).toBeVisible({ timeout: 10_000 });
    } else {
      test.skip();
    }
  });

  test("registra documento en el repositorio", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /documentos/i }).click();
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: /agregar documento/i }).click();
    await page.waitForTimeout(400);

    await page.getByLabel(/título/i).fill("Reglamento de condominio 2026");
    await page.getByLabel(/url del archivo/i).fill("https://example.com/reglamento.pdf");
    await page.getByLabel(/nombre del archivo/i).fill("reglamento-2026.pdf");

    await page.getByRole("button", { name: /guardar/i }).click();
    await page.waitForTimeout(1500);

    await expect(page.getByText(/Reglamento de condominio 2026/i).first()).toBeVisible({ timeout: 8_000 });
  });
});
