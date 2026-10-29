import { type Browser, type Page, expect, test } from "@playwright/test";

// VAT summary, reports, settings, import and setup wizard, once on desktop.
test.describe.configure({ mode: "serial" });

let page: Page;
const stamp = Date.now().toString().slice(-5);
// A valid EAN-13 that no seeded product uses.
const ean = (() => {
  const first12 = `61119${stamp}00`.slice(0, 12);
  const sum = [...first12].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0);
  return first12 + ((10 - (sum % 10)) % 10);
})();

async function loginAs(browser: Browser, user: string) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const res = await p.request.post("/api/auth/login", { data: { usr: user, pwd: "parapilot-dev" } });
  expect(res.ok()).toBeTruthy();
  await p.context().addCookies([{ name: "NEXT_LOCALE", value: "fr", url: "http://localhost:3000" }]);
  return p;
}

test.beforeAll(async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop-light", "runs once");
  page = await loginAs(browser, "owner@dev.local");
});
test.afterAll(async () => page?.close());

test("VAT summary matches the ledger and exports to Excel", async () => {
  await page.goto("/vat");
  await expect(page.getByText("TVA collectée", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Identique au grand livre.")).toBeVisible();
  await expect(page.getByText(/À déclarer sur SIMPL avant le/)).toBeVisible();
  await expect(page.getByText("À vérifier avant de déclarer")).toBeVisible();
  await page.screenshot({ path: "test-results/shots/vat-summary.png", fullPage: true });
  const file = await page.request.get(await page.getByRole("link", { name: "Exporter (Excel)" }).getAttribute("href") ?? "");
  expect(file.ok()).toBeTruthy();
  expect(file.headers()["content-type"]).toContain("spreadsheet");
});

test("reports: monthly sales chart, best sellers, Excel", async () => {
  await page.goto("/reports");
  await page.getByRole("button", { name: /Ventes du mois/ }).click();
  await expect(page.getByText("Ventes TTC par jour")).toBeVisible();
  await page.screenshot({ path: "test-results/shots/report-monthly.png", fullPage: true });
  await page.getByRole("button", { name: "Rapports" }).click();
  await page.getByRole("button", { name: /Meilleures ventes/ }).click();
  await expect(page.getByRole("cell", { name: "Crème hydratante 50 ml" })).toBeVisible();
  await page.getByRole("radio", { name: "Marge" }).click();
  await expect(page.getByRole("columnheader", { name: "Marge HT" })).toBeVisible();
  const file = await page.request.get(await page.getByRole("link", { name: "Excel" }).getAttribute("href") ?? "");
  expect(file.ok()).toBeTruthy();
});

test("settings: the cashier discount limit is saved", async () => {
  await page.goto("/settings");
  const limit = page.getByLabel("Remise maximale des caissiers (%)");
  await limit.fill("12");
  await page.locator("div", { has: limit }).getByRole("button", { name: "Enregistrer" }).last().click();
  await expect(page.getByText("Enregistré.").first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Remise maximale des caissiers (%)")).toHaveValue("12");
  await page.getByLabel("Remise maximale des caissiers (%)").fill("10");
  await page.locator("div", { has: page.getByLabel("Remise maximale des caissiers (%)") }).getByRole("button", { name: "Enregistrer" }).last().click();
  await expect(page.getByText("Enregistré.").first()).toBeVisible();
});

test("product import reports errors line by line, then imports", async () => {
  await page.goto("/settings");
  const bad = `nom;famille;code_barres;prix_ttc\r\nSérum ${stamp};Visage;${ean};249,00\r\n;Inconnue;6111000000017;abc\r\n`;
  await page.getByTestId("import-file").setInputFiles({ name: "produits.csv", mimeType: "text/csv", buffer: Buffer.from(bad) });
  await expect(page.getByText("Lignes à corriger")).toBeVisible();
  await expect(page.getByText(/Ligne 3/)).toBeVisible();
  const good = `nom;famille;code_barres;prix_ttc\r\nSérum ${stamp};Visage;${ean};249,00\r\n`;
  await page.getByTestId("import-file").setInputFiles({ name: "produits.csv", mimeType: "text/csv", buffer: Buffer.from(good) });
  await page.getByRole("button", { name: "Importer 1 produit" }).click();
  await expect(page.getByText("1 produit importé.")).toBeVisible();
});

test("setup wizard shows the eight steps", async () => {
  await page.goto("/setup");
  for (const step of ["Entreprise", "TVA", "Catégories TVA", "Familles", "Emplacements", "Caisses", "Utilisateurs", "Produits"]) {
    await expect(page.getByRole("button", { name: new RegExp(step) }).first()).toBeVisible();
  }
  await page.getByRole("button", { name: /Emplacements/ }).click();
  await expect(page.getByText("Quarantaine").first()).toBeVisible();
  await page.screenshot({ path: "test-results/shots/setup-wizard.png", fullPage: true });
});

test("accountant confirms VAT but cannot change till settings; cashier cannot open VAT", async ({ browser }) => {
  const accountant = await loginAs(browser, "accountant@dev.local");
  await accountant.goto("/settings");
  await expect(accountant.getByText("Caisse", { exact: true })).toHaveCount(0);
  await accountant.getByRole("button", { name: "Je confirme les catégories, comptes et paramètres de TVA" }).click();
  await expect(accountant.getByText(/Confirmé par accountant@dev.local/)).toBeVisible();
  await accountant.close();
  const cashier = await loginAs(browser, "cashier@dev.local");
  await cashier.goto("/vat");
  await expect(cashier).toHaveURL(/\/$/);
  await cashier.close();
});
