import { type Page, expect, test } from "@playwright/test";

// One cashier, one till: these steps run in order, once, on desktop; screenshots cover the tablet.
test.describe.configure({ mode: "serial" });
let page: Page;
let firstSale = "";

test.beforeAll(async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop-light", "the till flow runs once");
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const res = await page.request.post("/api/auth/login", { data: { usr: "cashier@dev.local", pwd: "parapilot-dev" } });
  expect(res.ok()).toBeTruthy();
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "fr", url: "http://localhost:3000" }]);
  // Start from a closed till even if an earlier run stopped half-way.
  const status = await (await page.request.get("/api/pos/status")).json();
  if (status.opening) await page.request.post("/api/pos/close", { data: { counted: {} } });
});

test.afterAll(async () => page?.close());

async function scan(code: string) {
  const search = page.getByRole("searchbox", { name: "Scanner ou rechercher un produit" });
  await search.fill(code);
  await search.press("Enter");
}

test("cashier opens the till", async () => {
  await page.goto("/till");
  await page.getByLabel("Fond de caisse").fill("500");
  await page.getByRole("button", { name: "Ouvrir la caisse" }).click();
  await expect(page).toHaveURL(/\/pos$/);
  await expect(page.getByText("Crème hydratante 50 ml").first()).toBeVisible();
});

test("3-item cash sale with the scanner in under 30 seconds", async () => {
  const started = Date.now();
  await scan("6111000000014"); // Crème hydratante 189,00
  await scan("6111000000045"); // Shampooing 159,50
  await scan("6111000000069"); // Liniment 85,00
  await expect(page.getByTestId("cart-total")).toHaveText(/433,50\s?DH/);
  await page.keyboard.press("F9");
  await page.getByLabel("Montant reçu").fill("500");
  await expect(page.getByTestId("change")).toHaveText(/66,50\s?DH/);
  await page.getByLabel("Montant reçu").press("Enter");
  await expect(page.getByRole("heading", { name: "Vente enregistrée" })).toBeVisible();
  const seconds = (Date.now() - started) / 1000;
  expect(seconds).toBeLessThan(30);
  test.info().annotations.push({ type: "sale duration", description: `${seconds.toFixed(1)} s` });

  // The receipt shows ERPNext's figures and, once sent, the invoice number.
  const receipt = page.locator(".receipt");
  await expect(receipt).toContainText("ICE 001234567000089");
  await expect(receipt).toContainText(/Total TTC \(DH\)\s*433,50/);
  await expect(receipt).toContainText(/TVA 20 %\s*361,25\s*72,25/);
  await expect(receipt).toContainText(/Ticket ACC-SINV-/, { timeout: 15_000 });
  firstSale = /Ticket (ACC-SINV-[\d-]+)/.exec((await receipt.textContent()) ?? "")![1];
  await page.screenshot({ path: "test-results/shots/pos-receipt.png" });
  await page.getByRole("button", { name: "Nouvelle vente" }).click();
});

test("keeps selling offline and sends the sale when back online", async () => {
  // Once the service worker controls the page, the till reloads even without internet.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByText("Crème hydratante 50 ml").first()).toBeVisible();

  await scan("6111000000052"); // Lait corps 99,00
  await expect(page.getByText(/Hors ligne/)).toBeVisible();
  await page.keyboard.press("F9");
  await page.getByRole("button", { name: "Montant exact" }).click();
  await page.getByRole("button", { name: "Valider la vente" }).click();
  await expect(page.getByRole("heading", { name: "Vente enregistrée" })).toBeVisible();
  await expect(page.getByText("Ticket provisoire").first()).toBeVisible();
  await page.screenshot({ path: "test-results/shots/pos-offline-receipt.png" });
  await page.getByRole("button", { name: "Nouvelle vente" }).click();
  await expect(page.getByTestId("pending")).toHaveText("1 vente à envoyer");
  await page.screenshot({ path: "test-results/shots/pos-offline.png" });

  await page.context().setOffline(false);
  await expect(page.getByTestId("pending")).toHaveCount(0, { timeout: 30_000 });
});

test("business customer gets an invoice with their ICE", async () => {
  await scan("6111000000021"); // Gel nettoyant 129,00
  await page.getByRole("button", { name: "Client", exact: true }).first().click();
  await page.getByRole("radio", { name: "Professionnel" }).click();
  await page.getByRole("button", { name: "Nouveau client" }).click();
  await page.getByLabel("Raison sociale").fill("Clinique Test SARL");
  await page.getByLabel("ICE (15 chiffres)").fill("005678901000034");
  await page.getByLabel("Adresse").fill("12 avenue Hassan II");
  await page.getByLabel("Ville").fill("Agadir");
  await page.getByRole("button", { name: "Créer et choisir" }).click();
  await expect(page.getByText("ICE 005678901000034").first()).toBeVisible();
  await page.keyboard.press("F9");
  await page.getByRole("radio", { name: "Carte" }).click();
  await page.getByRole("button", { name: "Valider la vente" }).click();
  const receipt = page.locator(".receipt");
  await expect(receipt).toContainText(/Facture ACC-SINV-/, { timeout: 15_000 });
  await expect(receipt).toContainText("Clinique Test SARL");
  await expect(receipt).toContainText("12 avenue Hassan II, Agadir");
  await expect(receipt).toContainText("ICE 005678901000034");
  await page.screenshot({ path: "test-results/shots/pos-b2b-invoice.png" });
  await page.getByRole("button", { name: "Nouvelle vente" }).click();
});

test("customer return above 200 DH needs the manager PIN", async () => {
  await page.goto("/returns");
  const scanBox = page.getByLabel("Scannez le code-barres du ticket ou saisissez le n° de facture");
  await scanBox.fill(firstSale);
  await scanBox.press("Enter");
  await expect(page.getByText(`Vente ${firstSale}`)).toBeVisible();
  // Shampooing 159,50 + crème 189,00 come back; the cream is damaged.
  const shampoo = page.locator("li", { hasText: "Shampooing anti-chute" });
  await shampoo.getByRole("button", { name: "+" }).click();
  const cream = page.locator("li", { hasText: "Crème hydratante" });
  await cream.getByRole("button", { name: "+" }).click();
  await cream.getByText("Abîmé : en quarantaine").click();
  await expect(page.getByTestId("refund-total")).toHaveText(/348,50\s?DH/);
  await page.getByRole("radio", { name: "Espèces" }).click();
  await page.getByRole("button", { name: "Valider le retour" }).click();
  await expect(page.getByRole("heading", { name: "Code PIN du responsable" })).toBeVisible();
  await page.keyboard.type("1234");
  await page.getByRole("button", { name: "Valider", exact: true }).click();
  const receipt = page.locator(".receipt");
  await expect(receipt).toContainText(/Ticket de retour ACC-SINV-/);
  await expect(receipt).toContainText(/Total TTC \(DH\)\s*-348,50/);
  await expect(receipt).toContainText("Remboursé");
  await page.screenshot({ path: "test-results/shots/return-receipt.png" });
  await page.keyboard.press("Escape");
  await page.goto("/pos");
});

test("tablet and phone layouts", async () => {
  for (const [name, width, height] of [["tablet-1024", 1024, 768], ["tablet-768", 768, 1024]] as const) {
    await page.setViewportSize({ width, height });
    // A tablet loads the till at its own width (the sidebar folds to icons).
    await page.reload();
    await scan("6111000000014");
    // The cart stays beside the products and nothing scrolls sideways.
    await expect(page.getByTestId("cart-total")).toBeInViewport();
    await expect(page.getByRole("button", { name: /Encaisser/ }).first()).toBeEnabled();
    await expect(page.getByRole("button", { name: /Retirer Crème/ }).first()).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/shots/pos-${name}.png` });
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await scan("6111000000014");
  await expect(page.getByRole("button", { name: /1 article/ })).toBeVisible();
  await page.screenshot({ path: "test-results/shots/pos-phone.png" });
  await page.getByRole("button", { name: /1 article/ }).click();
  await page.screenshot({ path: "test-results/shots/pos-phone-cart.png" });
  await page.getByRole("button", { name: "Vider le panier" }).click();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 900 });
});

test("closing shows the cash difference and the Z report", async () => {
  await page.goto("/till");
  // 32,50 DH taken out for bags during the day.
  await page.getByRole("button", { name: "Sortie de caisse" }).click();
  await page.getByLabel("Montant").fill("32,50");
  await page.getByLabel("Motif").fill("Sacs");
  await page.getByRole("button", { name: "Enregistrer la sortie" }).click();
  await expect(page.getByText("Sortie de caisse enregistrée.")).toBeVisible();
  await page.getByRole("button", { name: "Clôturer la caisse" }).click();
  // 500 float + 433,50 + 99,00 cash sales − 348,50 refunded − 32,50 taken out = 651,50 DH expected.
  await page.getByLabel("200,00 DH").fill("3");
  await page.getByLabel("50,00 DH").fill("1");
  await page.getByLabel("1,00 DH", { exact: true }).fill("1");
  await page.getByLabel("0,50 DH").fill("1");
  await expect(page.getByTestId("counted-cash")).toHaveText(/651,50\s?DH/);
  await page.getByRole("button", { name: "Voir les écarts" }).click();
  await expect(page.getByRole("cell", { name: /651,50\s?DH/ }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/shots/till-review.png" });
  await page.getByRole("button", { name: "Clôturer et imprimer le Z" }).click();
  await expect(page.getByText("RAPPORT Z", { exact: false }).first()).toBeVisible();
  await expect(page.locator(".print-area")).toContainText(/Sorties de caisse/i);
  await expect(page.locator(".print-area")).toContainText(/Sacs\s*−32,50/);
  await expect(page.locator(".print-area")).toContainText(/Retours \(1\)\s*-348,50/);
  await page.screenshot({ path: "test-results/shots/till-z.png", fullPage: true });
});

test("a shop that rounds to the dirham collects the rounded total", async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: "http://localhost:3000" });
  expect((await owner.request.post("/api/auth/login", { data: { usr: "owner@dev.local", pwd: "parapilot-dev" } })).ok()).toBeTruthy();
  const setRounding = (on: boolean) =>
    owner.request.post("/api/call/settings.save_settings", { data: { values: { round_sales_total: on ? 1 : 0 } } });
  expect((await setRounding(true)).ok()).toBeTruthy();
  try {
    await page.goto("/till");
    await page.getByLabel("Fond de caisse").fill("500");
    await page.getByRole("button", { name: "Ouvrir la caisse" }).click();
    await expect(page).toHaveURL(/\/pos$/);
    await scan("6111000000045"); // Shampooing 159,50
    await expect(page.getByTestId("cart-rounding")).toHaveText(/0,50\s?DH/);
    await expect(page.getByTestId("cart-total")).toHaveText(/160,00\s?DH/);
    await page.screenshot({ path: "test-results/shots/pos-rounding.png" });
    await page.keyboard.press("F9");
    await page.getByRole("button", { name: "Montant exact" }).click();
    await page.getByRole("button", { name: "Valider la vente" }).click();
    const receipt = page.locator(".print-receipt");
    await expect(receipt).toContainText(/Ticket ACC-SINV-/, { timeout: 15_000 });
    await expect(receipt).toContainText(/Arrondi\s*0,50/);
    await expect(receipt).toContainText(/Net à payer \(DH\)\s*160,00/);
    await page.getByRole("button", { name: "Nouvelle vente" }).click();
  } finally {
    await setRounding(false);
    await page.request.post("/api/pos/close", { data: { counted: {} } });
    await owner.close();
  }
});
