# parapilot (Frappe app)

Server side of ParaPilot. ERPNext stays the accounting, stock and VAT engine; this app adds what a
Moroccan parapharmacy needs on top of it:

- **Custom fields**: legal IDs on Company (ICE, IF, RC, TP), supplier type and terms, customer ICE and
  marketing consent, tester flag on Item, "company ICE on invoice" check on Purchase Invoice.
- **Roles**: ParaPilot Owner, Manager, Cashier, Stock Clerk, Accountant and AI, with document
  permissions enforced by ERPNext.
- **Validations**: ICE is 15 digits; an item cannot be saved, sold or bought without a VAT category
  (Item Tax Template, set on its item group).
- **Setup**: `parapilot.setup.defaults.apply_defaults(company)` creates the VAT templates, the
  TTC (tax-included) sales and purchase tax templates, the item groups, the warehouses and the price
  lists, and switches on row-wise VAT rounding.
- **API**: whitelisted methods under `parapilot.api.*`, one call per screen of the web app.

Settings live in the single doctype **ParaPilot Settings**. One ERPNext site serves one shop
(company); several shops means several sites.

Install on a bench:

```bash
bench get-app /path/to/apps/parapilot
bench --site <site> install-app parapilot
```

Targets ERPNext v16 (developed against 16.52.1).
