# Moving Derma Routine to ParaPilot

About 30 minutes, one evening with the shop closed. Rehearsed on a copy of the 29 October 2026 backup:
the takeover merges 19 accounts into the CGNC chart and the books still balance. After it, a till session was
taken over, a sale and a refund were rounded to the dirham, and the till closed with no difference.

## Before the evening

1. **GitHub**: make the repository private, then open *Actions* and check that the latest `images` run is
   green. Note its commit tag, for example `sha-b868222` (shown in the run's `meta` step).
2. **Server**: let Docker pull from GitHub's registry. Create a token on GitHub (*Settings → Developer
   settings → Personal access tokens → Tokens (classic)*, scope `read:packages` only), then on the server:
   ```bash
   docker login ghcr.io -u Adil-Arhrimaz      # paste the token when asked; never in a chat
   docker pull ghcr.io/adil-arhrimaz/parapilot-erpnext:sha-b868222
   docker pull ghcr.io/adil-arhrimaz/parapilot-web:sha-b868222
   ```
3. **Cloudflare**: in the tunnel, add the public hostname `app.dermaroutine.ma`, pointing to the same Traefik
   service as `erp.dermaroutine.ma`.
4. **Team**: from the next morning everyone uses `https://app.dermaroutine.ma` with their usual ERPNext email
   and password. Cashiers no longer open the ERPNext desk.

## The evening

Commands run on the server. The site name is `erp.dermaroutine.ma` (`SITE_NAME` in the stack's `.env`).

1. **Close the day's till in ERPNext** as usual. No ERPNext till session may stay open.
2. **Backup**, and copy it off the server:
   ```bash
   docker exec erpnext-backend bench --site erp.dermaroutine.ma backup --with-files
   docker exec erpnext-backend ls -la sites/erp.dermaroutine.ma/private/backups | tail -5
   ```
   Note the file names of this backup (database, files, private files): they are the way back.
3. **New images.** In the stack's `.env` add:
   ```
   ERPNEXT_IMAGE=ghcr.io/adil-arhrimaz/parapilot-erpnext:sha-b868222
   PARAPILOT_WEB_IMAGE=ghcr.io/adil-arhrimaz/parapilot-web:sha-b868222
   APP_HOST=app.dermaroutine.ma
   ```
   Replace the stack file with `deploy/stack.production.yml`. Remove the ERPNext containers with their
   anonymous volumes (the old interface files; the database and site files are in named volumes and stay):
   ```bash
   docker rm -fv erpnext-backend erpnext-frontend erpnext-websocket erpnext-queue-short \
     erpnext-queue-long erpnext-scheduler erpnext-backup erpnext-configurator erpnext-create-site
   ```
   Then update the stack in Portainer (re-pull off: the images are already on the server).
4. **Install ParaPilot and take over the company:**
   ```bash
   docker exec erpnext-backend bench --site erp.dermaroutine.ma install-app parapilot
   docker exec erpnext-backend bench --site erp.dermaroutine.ma migrate
   docker exec erpnext-backend bench --site erp.dermaroutine.ma execute parapilot.setup.prod_cutover.run
   ```
   The last command prints `merged: 19`, `accounts_kept: 0`, `groups_given_vat: 529` and
   `items_with_batches: 11800` (numbers may differ slightly if products were added since the rehearsal).
   `accounts_kept` above 0 or any error: stop and send the output.
5. **Refresh:**
   ```bash
   docker exec erpnext-backend bench --site erp.dermaroutine.ma clear-cache
   docker restart erpnext-backend erpnext-frontend erpnext-queue-short erpnext-queue-long erpnext-scheduler
   ```
   In Cloudflare, purge `https://erp.dermaroutine.ma/assets/*`.
6. **Check** at `https://app.dermaroutine.ma`, logged in as adil:
   - *Settings*: company, rounding to the dirham on, the five people with their roles.
   - *Products*: search a product; it shows its price and TVA 20 %.
   - *Opening and closing*: open Caisse 1, sell a cheap product in cash (the total is rounded), refund it from
     *Returns*, close the till: no difference.
   - User menu → *Manager PIN*: choose the PIN that approves cashiers' refunds.
   - `https://erp.dermaroutine.ma` still opens for adil.

## If something goes wrong

Before the shop opens, go back to the backup of step 2:

1. In `.env`, remove `ERPNEXT_IMAGE` (back to `frappe/erpnext:v16.52.1`); remove the containers as in step 3 and
   update the stack.
2. Restore:
   ```bash
   cd sites/erp.dermaroutine.ma/private/backups   # inside erpnext-backend
   bench --site erp.dermaroutine.ma restore <database>.sql.gz \
     --with-public-files <files>.tar --with-private-files <private-files>.tar --db-root-password <root password>
   ```
   ERPNext is then exactly as it was before the evening.

## In the following days

- **Accountant**: confirm the VAT categories in *Settings* (every family is at 20 % for now) and the account
  mapping; clear the opening balance left in 3990 *Ouverture temporaire* (−31,514.81 DH); enter the 88 delivery
  notes not yet invoiced as supplier invoices (*Supplier invoices → New*), so the supplier debt and deductible
  VAT are in the books.
- **Stock count**: the 504 products with stock history have no lots yet; count them, then enter lot and expiry,
  so the expiry board covers them.
- **Encryption key**: copy `encryption_key` from `sites/erp.dermaroutine.ma/site_config.json` into a password
  manager. The backups do not contain it.
