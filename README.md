# ParaPilot

Parapharmacy app on top of ERPNext v16 for Derma Routine (Agadir). ERPNext stays the accounting, stock and
VAT engine; ParaPilot replaces the daily screens. See the product specification for the full scope.

```
apps/parapilot/   Frappe app installed in ERPNext: custom fields, roles, Moroccan rules, CGNC chart, API
web/              Next.js 16 app (counter, back office, phone) + server (BFF) that talks to ERPNext
deploy/           Local ERPNext 16.52.1 + parapilot in Docker
```

## Run locally

```bash
# 1. ERPNext 16.52.1 with parapilot (first start takes a few minutes)
docker compose -f deploy/compose.dev.yml up -d --build
docker exec parapilot-dev-backend-1 bench --site erp.localhost execute parapilot.setup.dev_seed.run

# 2. Web app
cd web && cp .env.example .env.local && npm install && npm run dev   # http://localhost:3000
```

Dev users (password `parapilot-dev`): `owner@`, `manager@`, `cashier@`, `stock@`, `accountant@dev.local`.
Owner and manager approval PIN: `1234`. A new shop starts at `/setup`.
ERPNext desk: http://localhost:8080 (Administrator / admin). After changing Python code:
`docker compose -f deploy/compose.dev.yml restart backend queue scheduler`.

## Tests

```bash
cd web
npm test                 # VAT, cart, rounding, ICE, EAN-13; till arithmetic checked against 400 ERPNext baskets
npx playwright test      # screens at 375/768/1280 px, light/dark, FR/EN; full till day incl. offline
docker exec parapilot-dev-backend-1 bench --site erp.localhost run-tests --app parapilot   # inside ERPNext
```

The ERPNext tests run on the dev site and roll back everything they create.

## How it fits together

- **Login**: each person logs in with their own ERPNext account. The server keeps the ERPNext session in an
  httpOnly cookie and calls ERPNext with it, so ERPNext permissions apply to everything. The browser never
  calls ERPNext.
- **Roles**: Owner, Manager, Cashier, Stock Clerk, Accountant and AI are ERPNext roles and role profiles
  (`parapilot.setup.install`). Cashier, Stock Clerk and AI have explicit document permissions.
- **VAT**: one Item Tax Template per category on the item group (TVA 20 %, TVA 10 %, Exonéré, plus overhead
  variants posting to separate deductible accounts). Sales and purchase templates are "included in rate", so
  every price is TTC. VAT is rounded per line; totals are not rounded to the dirham.
- **Point of sale**: each ticket is a paid Sales Invoice (ERPNext v16's POS flow) that moves stock at once;
  ERPNext picks batches first-expired-first-out. The till computes totals with `web/src/lib/erpnext-tax.ts`,
  an operation-by-operation copy of ERPNext's tax code, so offline receipts show what ERPNext books.
  Sales are queued on the device (IndexedDB) and sent with a unique device ID, so a retry never creates a
  second invoice. A service worker lets the till reload without internet. Closing is blocked until the queue
  is empty; the Z report is a submitted POS Closing Entry.
- **Purchasing**: purchase order → delivery note (Purchase Receipt: lot and expiry per line, free units at zero
  cost in the same batch, damaged units to Quarantaine with a draft return) → supplier invoice (several
  delivery notes at once, lines more than 1 % off the delivery note highlighted, our-ICE check) → payment
  (cash limits of 5 000 DH/day and 50 000 DH/month per supplier, with the VAT at risk). Overheads are
  invoiced on non-stock items in "Frais généraux", each with its CGNC expense account.
- **Stock**: quantities per location and value at cost from the batch ledger; expiry board (expired, 30, 60,
  90 days); transfers (Material Transfer, first-expired-first-out); write-offs (Material Issue) with one
  expense account per reason (61851–61854); blind stock counts saved as draft Stock Reconciliations that an
  owner or manager approves.
- **Returns**: customer returns are return Sales Invoices made from the original sale (VAT and batches
  reversed, back to the shop floor or to quarantine); cashiers need a manager PIN above the threshold in
  ParaPilot Settings (PIN per manager, encrypted on the User, 5 attempts per 10 minutes). Supplier returns are
  return Purchase Receipts; supplier credit notes (avoirs) are debit notes that reduce the original invoice.
- **Customers**: walk-in by default; named customers found by phone (`pp_phone`) keep a purchase history, with
  marketing consent and its date (Law 09-08).
- **VAT summary** (`parapilot.api.vat`): VAT collected per rate from the ledger; deductible VAT on goods and
  overheads counted on paid invoices only (paid share × net VAT, so part payments and credit notes are handled);
  VAT on cash paid above the limits shown as not deductible; credit carried from period to period; deadline,
  nil-return reminder, the four pre-declaration checks and an Excel export.
- **Reports** (`parapilot.api.reports`): daily summary, monthly sales (vs last month and last year), best
  sellers, margins, slow movers, expiry, stock value, purchases by supplier; Excel export, print to PDF.
- **Settings and setup wizard** (`parapilot.api.settings`): company and legal IDs, VAT settings with the
  accountant's confirmation, VAT category per family, tills, users and roles, product import from CSV.
- **Browser → server calls** for purchasing go through `web/src/app/api/call/[method]`, an explicit allowlist of
  `parapilot.api.*` methods.
- **Chart of accounts**: `parapilot/setup/chart_ma.py`, a CGNC chart for a parapharmacy (ERPNext's own
  Moroccan chart has no root types and cannot produce a balance sheet). To be reviewed by the accountant.

## Status

| Milestone | State |
| --- | --- |
| 1. Foundation: Frappe app, roles, VAT setup, login, theme, FR/EN, responsive shell, products | Done |
| 2. Point of sale (offline queue, FEFO batches, receipts), till opening/closing | Done |
| 3. Purchasing and receiving (PO, delivery notes, invoices, payments, cash limits) | Done |
| 4. Stock (expiry board, counts, transfers, write-offs), returns, customers | Done |
| 5. Reports, VAT summary, setup wizard, settings | Done |

## MVP acceptance checklist (spec section 10)

| # | Item | Evidence | Still to do in the shop |
| --- | --- | --- | --- |
| 1 | 3-item cash sale with a scanner in under 30 s | e2e `pos.spec` (≈1 s scripted) | Time a real cashier |
| 2 | 189.00 TTC at 20 % = 157.50 HT + 31.50 VAT on receipt and in ERPNext | `test_sale_at_189_ttc_posts_31_50_vat`, unit tests, product screen | — |
| 3 | Delivery note with batch and expiry; stock up, nothing owed | `test_order_receive_invoice_pay`, e2e `purchasing.spec` | — |
| 4 | One invoice from 3 delivery notes; >1 % price difference highlighted | `test_one_invoice_for_three_delivery_notes`, e2e | — |
| 5 | Customer return reverses VAT and appears in the VAT summary | `test_customer_return_reverses_vat…`, `test_customer_return_appears_in_the_vat_summary` | — |
| 6 | Till closing shows the cash difference; Z report cannot be edited | `test_closing_reports_the_cash_difference`, e2e (submitted POS Closing Entry) | — |
| 7 | VAT summary matches the VAT accounts to the centime | `ledger.collected == collected_total` in tests and on screen | Accountant compares a real month |
| 8 | Cashier cannot change a price, see a margin or exceed the discount limit | permission tests, discount-limit test, role checks on screens | — |
| 9 | POS sells offline, then syncs without duplicates | e2e offline sale + offline reload, idempotency test | One full hour offline on the real till |
| 10 | Every screen in FR/EN, light/dark, phone/tablet/desktop | products matrix (30 runs), POS and receiving on phone/tablet | Walk every screen on the shop's devices |
| 11 | Accountant confirms VAT categories, accounts and settings | "Je confirme…" in Settings records who and when | Your accountant does it |

## Production notes

- Do not run ERPNext's own setup wizard after ParaPilot is installed: it resets System Settings, including the
  rounding method (ParaPilot needs Commercial Rounding). Re-run `apply_defaults` if it happens.
- With tax-included prices ERPNext sometimes books HT + VAT one centime away from TTC (rounding adjustment);
  receipts show ERPNext's figures. To be explained to the accountant.
- Install the app on a **staging copy** of production first: `apply_defaults` changes global ERPNext settings
  (row-wise VAT rounding, no rounded totals, FEFO batch picking, item naming series, POS invoice type; on the
  buying side: invoice prices may differ from the delivery note and stock is revalued at the invoiced price,
  damaged units are not billed, up to 10 % over-billing against an order, unique supplier invoice numbers).
- The overhead items (electricity, rent, fees…) default to 20 % deductible VAT: the accountant should confirm
  each one (rent, for example, depends on the landlord).
- MariaDB 11.6+: run with `innodb_snapshot_isolation=OFF`, or concurrent logins and sales fail with
  error 1020 (see `deploy/compose.dev.yml`).
