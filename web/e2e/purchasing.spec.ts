import { type Page, expect, test } from "@playwright/test";

// One supplier through its whole cycle, in order, once (desktop); screenshots cover the phone.
test.describe.configure({ mode: "serial" });

let page: Page;
const supplier = `Labo Test ${Date.now().toString(36).toUpperCase()}`;
const billNo = `FA-${Date.now().toString(36).toUpperCase()}`;
const nextYear = `${new Date().getFullYear() + 1}-06-30`;

test.beforeAll(async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop-light", "the purchasing cycle runs once");
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const res = await page.request.post("/api/auth/login", { data: { usr: "owner@dev.local", pwd: "parapilot-dev" } });
  expect(res.ok()).toBeTruthy();
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "fr", url: "http://localhost:3000" }]);
});

test.afterAll(async () => page?.close());

async function chooseSupplier() {
  await page.getByRole("combobox", { name: /Choisir un fournisseur|Fournisseur/ }).first().click();
  await page.getByPlaceholder("Choisir un fournisseur").fill(supplier);
  await page.getByRole("option", { name: supplier }).click();
}

test("owner creates a supplier", async () => {
  await page.goto("/suppliers");
  await page.getByRole("button", { name: "Nouveau fournisseur" }).click();
  await page.getByLabel("Raison sociale").fill(supplier);
  await page.getByLabel("ICE", { exact: true }).fill("12345");
  await expect(page.getByText("L'ICE doit comporter 15 chiffres.")).toBeVisible();
  await page.getByLabel("ICE", { exact: true }).fill("004 567 890 000 012");
  await page.getByLabel("Délai de livraison (jours)").fill("4");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Fournisseur enregistré.")).toBeVisible();
  await expect(page.getByRole("cell", { name: supplier })).toBeVisible();
});

test("purchase order for 6 creams at 120,00 TTC", async () => {
  await page.goto("/purchase-orders/new");
  await chooseSupplier();
  const picker = page.getByRole("searchbox", { name: "Scanner ou rechercher un produit" });
  await picker.fill("6111000000014");
  await picker.press("Enter");
  await expect(page.getByText("Crème hydratante 50 ml")).toBeVisible();
  await page.getByLabel("Qté").fill("6");
  await page.getByLabel("Prix TTC").fill("120,00");
  await expect(page.getByTestId("doc-total")).toHaveText(/720,00\s?DH/);
  await page.getByRole("button", { name: "Valider la commande" }).click();
  await expect(page.getByText("Commande validée.")).toBeVisible();
  await expect(page).toHaveURL(/\/purchase-orders\/PUR-ORD-/);
  await page.screenshot({ path: "test-results/shots/purchase-order.png", fullPage: true });
});

test("receiving: 5 good, 1 damaged, 1 free, with lot and expiry", async () => {
  await page.getByRole("link", { name: "Réceptionner" }).click();
  await expect(page.getByText("Commandé : 6")).toBeVisible();
  await page.getByLabel("N° du bon de livraison").fill("BL-E2E-1");
  await page.getByLabel("Reçus").fill("5");
  await page.getByLabel("Abîmés").fill("1");
  await page.getByLabel("Gratuits").fill("1");
  await page.getByLabel("N° de lot").fill(`L${Date.now().toString(36)}`);
  await page.getByLabel("Péremption").fill(nextYear);
  await page.screenshot({ path: "test-results/shots/receiving.png", fullPage: true });
  await page.getByRole("button", { name: /Valider la réception/ }).click();
  await expect(page.getByText("Réception enregistrée : le stock a été mis à jour.")).toBeVisible();
  await expect(page.getByText(/Un retour fournisseur est préparé/)).toBeVisible();
  await expect(page).toHaveURL(/\/receiving$/);
});

test("supplier invoice 2 % dearer than the delivery note is highlighted", async () => {
  await page.goto("/supplier-invoices/new");
  await chooseSupplier();
  await page.getByLabel("N° de facture fournisseur").fill(billNo);
  await page.getByText("BL-E2E-1").click();
  await page.getByRole("button", { name: "Reprendre les lignes" }).click();
  const price = page.getByLabel("Prix TTC").first();
  await expect(price).toHaveValue("120,00");
  await price.fill("122,40");
  await expect(page.getByText(/Écart de plus de 1 %/)).toBeVisible();
  await page.getByText("Notre ICE figure sur la facture").click();
  await expect(page.getByTestId("doc-total")).toHaveText(/612,00\s?DH/); // 5 × 122,40 + free unit at 0
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await expect(page).toHaveURL(/\/supplier-invoices\/ACC-PINV-/);
  await page.getByRole("button", { name: "Valider la facture" }).click();
  await expect(page.getByText("Facture validée : la dette fournisseur est enregistrée.")).toBeVisible();
  await expect(page.getByTestId("outstanding")).toHaveText(/612,00\s?DH/);
  await page.screenshot({ path: "test-results/shots/supplier-invoice.png", fullPage: true });
});

test("cash payment settles the invoice", async () => {
  await page.getByRole("button", { name: "Enregistrer un paiement" }).click();
  await page.getByRole("radio", { name: "Espèces" }).click();
  await expect(page.getByText(/Espèces payées à ce fournisseur/)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer un paiement" }).click();
  await expect(page.getByText("Paiement enregistré.")).toBeVisible();
  await expect(page.getByTestId("outstanding")).toHaveText(/0,00\s?DH/);
});

test("an invoiced delivery note can be opened but not corrected", async () => {
  await page.goto("/receiving");
  await page.getByRole("link", { name: /BL-E2E-1/ }).filter({ hasText: supplier }).click();
  await expect(page.getByRole("cell", { name: "Crème hydratante 50 ml" }).first()).toBeVisible();
  await expect(page.getByText(/Une facture fournisseur inclut ce bon/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Annuler la livraison" })).toHaveCount(0);
});

test("a delivery note is corrected, then cancelled", async () => {
  await page.goto("/receiving/new");
  await chooseSupplier();
  await page.getByLabel("N° du bon de livraison").fill("BL-E2E-2");
  const picker = page.getByRole("searchbox", { name: "Scanner ou rechercher un produit" });
  await picker.fill("6111000000014");
  await picker.press("Enter");
  await page.getByLabel("Reçus").fill("2");
  await page.getByLabel("N° de lot").fill(`M${Date.now().toString(36)}`);
  await page.getByLabel("Péremption").fill(nextYear);
  await page.getByLabel("Prix TTC").fill("120,00");
  await page.getByRole("button", { name: /Valider la réception/ }).click();
  await expect(page).toHaveURL(/\/receiving$/);

  await page.getByRole("link", { name: /BL-E2E-2/ }).filter({ hasText: supplier }).click();
  await page.getByRole("link", { name: "Corriger" }).click();
  await expect(page.getByRole("heading", { name: /Corriger la livraison/ })).toBeVisible();
  await expect(page.getByLabel("Reçus")).toHaveValue("2");
  await page.getByLabel("Reçus").fill("3");
  await page.getByRole("button", { name: /Enregistrer la correction/ }).click();
  await expect(page.getByText("Livraison corrigée : stock et coûts mis à jour.")).toBeVisible();
  await expect(page.getByText(/Corrige le bon/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "3", exact: true }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/shots/receipt-corrected.png", fullPage: true });

  await page.getByRole("button", { name: "Annuler la livraison" }).click();
  await page.getByLabel("Motif").fill("Saisie en double");
  await page.getByRole("dialog").getByRole("button", { name: "Annuler la livraison" }).click();
  await expect(page.getByText("Bon de livraison annulé.")).toBeVisible();
  await expect(page.getByText("Annulée").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Corriger" })).toHaveCount(0);
});

test("phone receiving layout", async () => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/receiving/new");
  await page.screenshot({ path: "test-results/shots/receiving-phone.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
