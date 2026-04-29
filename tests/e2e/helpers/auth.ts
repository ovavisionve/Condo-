import { type Page } from "@playwright/test";

export const TEST_EMAIL    = "admin@condominios.local";
export const TEST_PASSWORD = "admin1234";

export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/correo|email/i).fill(TEST_EMAIL);
  await page.getByLabel(/contraseña|password/i).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /entrar|iniciar|login|sign in/i }).click();
  // Esperar a llegar a /org o /platform
  await page.waitForURL(/\/(org|platform)/, { timeout: 15_000 });
}

/** Navega a la primera comunidad disponible y devuelve su ID de la URL */
export async function goToCommunity(page: Page, communityId = "hugo-chavez-frias-seed"): Promise<string> {
  await page.goto(`/org/communities/${communityId}`);
  await page.waitForLoadState("networkidle");
  return communityId;
}
