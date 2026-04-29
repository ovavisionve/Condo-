import { test, expect } from "@playwright/test";
import { login, TEST_EMAIL } from "./helpers/auth";

test.describe("Autenticación", () => {
  test("login exitoso con credenciales válidas", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/(org|platform)/);
  });

  test("muestra error con contraseña incorrecta", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/correo|email/i).fill(TEST_EMAIL);
    await page.getByLabel(/contraseña|password/i).fill("wrong-password-xyz");
    await page.getByRole("button", { name: /entrar|iniciar|login|sign in/i }).click();
    // Debe quedarse en /login o mostrar error
    await page.waitForTimeout(2000);
    const url = page.url();
    const hasError = url.includes("/login") || (await page.getByText(/inválid|incorrect|error/i).count()) > 0;
    expect(hasError).toBeTruthy();
  });

  test("redirige a /login si no está autenticado", async ({ page }) => {
    await page.goto("/org");
    await page.waitForURL(/\/login/, { timeout: 8_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("logout cierra la sesión", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: /salir|logout|sign out/i }).click();
    await page.waitForURL(/\/login/, { timeout: 8_000 });
    await expect(page).toHaveURL(/\/login/);
  });
});
