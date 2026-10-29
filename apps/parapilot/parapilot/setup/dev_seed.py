"""Development data only. Refuses to run unless the site is in developer mode.

docker exec parapilot-dev-backend-1 bench --site erp.localhost execute parapilot.setup.dev_seed.run
"""

import frappe
from parapilot.setup.company import create_company
from parapilot.setup.defaults import apply_defaults

COMPANY = "Derma Routine Dev"
PASSWORD = "parapilot-dev"
DEV_PIN = "1234"

USERS = {
	"owner@dev.local": ("Owner Dev", "ParaPilot Owner"),
	"manager@dev.local": ("Manager Dev", "ParaPilot Manager"),
	"cashier@dev.local": ("Cashier Dev", "ParaPilot Cashier"),
	"stock@dev.local": ("Stock Dev", "ParaPilot Stock Clerk"),
	"accountant@dev.local": ("Accountant Dev", "ParaPilot Accountant"),
}

# Placeholder products: (name, group, brand, EAN-13, price TTC)
PRODUCTS = [
	("Crème hydratante 50 ml", "Visage", "Marque A", "6111000000014", 189.00),
	("Gel nettoyant 200 ml", "Visage", "Marque A", "6111000000021", 129.00),
	("Écran solaire SPF50 50 ml", "Solaires", "Marque B", "6111000000038", 215.00),
	("Shampooing anti-chute 400 ml", "Cheveux", "Marque C", "6111000000045", 159.50),
	("Lait corps 400 ml", "Corps", "Marque B", "6111000000052", 99.00),
	("Liniment bébé 500 ml", "Bébé et maman", "Marque C", "6111000000069", 85.00),
]


def run():
	if not frappe.conf.developer_mode:
		frappe.throw("dev_seed only runs on a developer-mode site.")

	if not frappe.db.exists("Company", COMPANY):
		create_company(
			COMPANY,
			"DRD",
			{"pp_ice": "001234567000089", "pp_if": "12345678", "pp_rc": "12345", "pp_tp": "12345678"},
		)
		frappe.db.set_single_value(
			"System Settings",
			{"country": "Morocco", "time_zone": "Africa/Casablanca", "currency": "MAD", "language": "fr"},
		)

	apply_defaults(COMPANY)

	for email, (full_name, profile) in USERS.items():
		if not frappe.db.exists("User", email):
			frappe.get_doc(
				{
					"doctype": "User",
					"email": email,
					"first_name": full_name,
					"send_welcome_email": 0,
					"language": "fr",
					"role_profiles": [{"role_profile": profile}],
					"new_password": PASSWORD,
				}
			).insert(ignore_permissions=True)

	from parapilot.api.catalog import save_product

	for name, group, brand, barcode, price in PRODUCTS:
		if frappe.db.exists("Item Barcode", {"barcode": barcode}):
			continue
		save_product(
			{
				"item_name": name,
				"item_group": group,
				"brand": brand,
				"barcodes": [barcode],
				"price_ttc": price,
				"has_batch_no": 1,
			}
		)

	receive_stock()

	from parapilot.api.returns import store_pin

	for email in ("owner@dev.local", "manager@dev.local"):
		store_pin(email, DEV_PIN)

	frappe.db.commit()
	print(f"Seeded {COMPANY}; users {', '.join(USERS)} with password {PASSWORD}")


def receive_stock():
	"""Two batches per batch-tracked product, expiring in 2 and 14 months, so first-expired-first-out
	can be checked at the till. Runs once."""
	from frappe.utils import add_months, today

	settings = frappe.get_single("ParaPilot Settings")
	if frappe.db.exists("Stock Entry", {"remarks": "ParaPilot dev seed"}):
		return
	entry = frappe.get_doc(
		{
			"doctype": "Stock Entry",
			"stock_entry_type": "Material Receipt",
			"company": COMPANY,
			"remarks": "ParaPilot dev seed",
			"items": [],
		}
	)
	for name, _group, _brand, barcode, price in PRODUCTS:
		item = frappe.db.get_value("Item Barcode", {"barcode": barcode}, "parent")
		has_batch = frappe.db.get_value("Item", item, "has_batch_no")
		cost = round(price / 1.2 / 1.6, 2)
		for months, qty in ((2, 5), (14, 20)) if has_batch else ((0, 25),):
			row = {
				"item_code": item,
				"qty": qty,
				"t_warehouse": settings.shop_floor_warehouse,
				"basic_rate": cost,
				"use_serial_batch_fields": 1,
			}
			if has_batch:
				batch = frappe.get_doc(
					{
						"doctype": "Batch",
						"item": item,
						"batch_id": f"{item}-L{months:02d}",
						"expiry_date": add_months(today(), months),
					}
				).insert(ignore_if_duplicate=True)
				row["batch_no"] = batch.name
			entry.append("items", row)
	entry.insert()
	entry.submit()


def show_errors(limit: int = 3):
	"""Print the latest Error Log entries (bench execute swallows some tracebacks)."""
	for e in frappe.get_all(
		"Error Log", fields=["creation", "method", "error"], order_by="creation desc", limit=limit
	):
		print("==", e.creation, e.method)
		print(e.error[-3000:])

