import { type Page, expect, test } from "@playwright/test";

const PASSWORD = "parapilot-dev";

async function login(page: Page, user: string, language: "fr" | "en") {
  const res = await page.request.post("/api/auth/login", { data: { usr: user, pwd: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  // Login sets the user's saved language; override it for this browser only, so parallel runs in
  // both languages do not change the shared ERPNext user.
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: language, url: test.info().project.use.baseURL! }]);
}

for (const language of ["fr", "en"] as const) {
  test.describe(`products (${language})`, () => {
    test("owner finds a product and sees its VAT split", async ({ page }, info) => {
      await login(page, "owner@dev.local", language);
      await page.goto("/products");
      await expect(page.getByText("Crème hydratante 50 ml").filter({ visible: true }).first()).toBeVisible();
      await page.screenshot({ path: `test-results/shots/${info.project.name}-${language}-products.png`, fullPage: true });

      // A scanner types the barcode and presses Enter.
      const search = page.getByRole("searchbox");
      await search.fill("6111000000014");
      await expect(page.getByText("Crème hydratante 50 ml").filter({ visible: true }).first()).toBeVisible();
      await search.press("Enter");
      await expect(page).toHaveURL(/\/products\/ART-00001$/);

      // 189.00 TTC at 20% = 157.50 HT + 31.50 VAT (spec acceptance checklist).
      const split = language === "fr" ? /HT 157,50\s?DH · TVA 31,50\s?DH/ : /excl\. VAT 157\.50 DH · VAT 31\.50 DH/;
      await expect(page.getByText(split).filter({ visible: true })).toBeVisible();
      await page.screenshot({ path: `test-results/shots/${info.project.name}-${language}-product.png`, fullPage: true });
    });

    test("cashier cannot open products", async ({ page }) => {
      await login(page, "cashier@dev.local", language);
      await page.goto("/products");
      await expect(page).toHaveURL(/\/$/);
    });
  });
}

test("login screen", async ({ page }, info) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /Se connecter|Log in/ })).toBeVisible();
  await page.screenshot({ path: `test-results/shots/${info.project.name}-login.png` });
});
