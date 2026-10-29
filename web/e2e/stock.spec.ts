import { type Browser, type Page, expect, test } from "@playwright/test";

// The stock clerk's day, in order, once (desktop); the manager approves the count. It uses the sun
// cream, which the till test does not sell, so both can run in parallel.
test.describe.configure({ mode: "serial" });

let page: Page;
let countUrl = "";

async function loginAs(browser: Browser, user: string) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const res = await p.request.post("/api/auth/login", { data: { usr: user, pwd: "parapilot-dev" } });
  expect(res.ok()).toBeTruthy();
  await p.context().addCookies([{ name: "NEXT_LOCALE", value: "fr", url: "http://localhost:3000" }]);
  return p;
}

async function scan(code: string) {
  const picker = page.getByRole("searchbox", { name: /Scanner ou rechercher/ }).first();
  await picker.fill(code);
  await picker.press("Enter");
}

test.beforeAll(async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop-light", "the stock flow runs once");
  page = await loginAs(browser, "stock@dev.local");
});
test.afterAll(async () => page?.close());

test("transfer 2 sun creams from the shop floor to the back store", async () => {
  await page.goto("/transfers");
  await page.getByRole("button", { name: "Inverser" }).click();
  await scan("6111000000038");
  await expect(page.getByText("Écran solaire SPF50 50 ml")).toBeVisible();
  await page.getByLabel("Qté").fill("2");
  await page.getByRole("button", { name: "Valider le transfert" }).click();
  await expect(page.getByText("Transfert enregistré.")).toBeVisible();
});

test("stock shows the back store and has no costs for the stock clerk", async () => {
  await page.goto("/stock");
  await page.getByRole("searchbox", { name: "Nom, marque ou code-barres" }).fill("6111000000038");
  const row = page.getByRole("row", { name: /Écran solaire/ });
  await expect(row).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Valeur au coût" })).toHaveCount(0);
  await page.getByRole("radio", { name: "Péremption" }).click();
  await expect(page.getByText("Sous 30 jours")).toBeVisible();
  await page.screenshot({ path: "test-results/shots/expiry-board.png", fullPage: true });
});

test("write off a broken sun cream", async () => {
  await page.goto("/transfers");
  await page.getByRole("radio", { name: "Perte" }).click();
  await page.getByRole("radio", { name: "Casse" }).click();
  await scan("6111000000038");
  await expect(page.getByRole("combobox", { name: "Lot" })).toContainText(/disponibles/);
  await page.getByRole("button", { name: "Valider la sortie" }).click();
  await expect(page.getByText("Sortie de stock enregistrée.")).toBeVisible();
});

test("blind count of the back store goes to the manager", async () => {
  await page.goto("/stock-count");
  await page.getByRole("button", { name: "Nouvel inventaire" }).click();
  await page.getByRole("radio", { name: "Réserve" }).click();
  await page.getByRole("button", { name: "Commencer le comptage" }).click();
  await page.getByRole("searchbox", { name: "Scanner ou rechercher dans la liste" }).fill("Écran");
  const first = page.getByRole("textbox", { name: /Écran solaire/ }).first();
  await first.fill("0");
  await page.getByRole("button", { name: "Terminer le comptage" }).click();
  await expect(page).toHaveURL(/\/stock-count\/MAT-RECO-/);
  await expect(page.getByText("Un responsable doit valider l'ajustement.")).toBeVisible();
  countUrl = page.url();
});

test("manager approves the adjustment", async ({ browser }) => {
  const manager = await loginAs(browser, "manager@dev.local");
  await manager.goto(countUrl);
  await expect(manager.getByRole("cell", { name: /^-\d/ }).first()).toBeVisible();
  await manager.getByRole("button", { name: "Valider l'ajustement" }).click();
  await expect(manager.getByText("Ajustement de stock validé.")).toBeVisible();
  await manager.screenshot({ path: "test-results/shots/count-approved.png", fullPage: true });
  await manager.close();
});
