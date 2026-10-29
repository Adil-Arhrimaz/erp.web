"""Company defaults for a Moroccan parapharmacy. Every function is idempotent and can be re-run."""

import frappe
from frappe import _
from frappe.custom.doctype.property_setter.property_setter import make_property_setter

from parapilot.setup.chart_ma import VAT_COLLECTED, VAT_DEDUCTIBLE_GOODS, VAT_DEDUCTIBLE_OVERHEADS

RATES = (20, 10)

# category: (title, rate, deductible account kind). Overheads post their VAT to separate accounts so the
# VAT summary can show deductible VAT on goods and on overheads apart.
TEMPLATES = {
	"standard": ("TVA 20%", 20, "deductible_goods"),
	"reduced": ("TVA 10%", 10, "deductible_goods"),
	"exempt": ("Exonéré", 0, None),
	"standard_overheads": ("TVA 20% (frais généraux)", 20, "deductible_overheads"),
	"reduced_overheads": ("TVA 10% (frais généraux)", 10, "deductible_overheads"),
}
VAT_ACCOUNT_NAMES = {
	"collected": VAT_COLLECTED,
	"deductible_goods": VAT_DEDUCTIBLE_GOODS,
	"deductible_overheads": VAT_DEDUCTIBLE_OVERHEADS,
}

ITEM_GROUPS = [
	("Visage", "standard"),
	("Corps", "standard"),
	("Solaires", "standard"),
	("Cheveux", "standard"),
	("Bébé et maman", "standard"),
	("Hygiène bucco-dentaire", "standard"),
	("Compléments alimentaires", "standard"),
	("Minceur", "standard"),
	("Matériel médical", "standard"),
	("Homme", "standard"),
	("Accessoires", "standard"),
	("Frais généraux", "standard_overheads"),
]

WAREHOUSES = {
	"shop_floor_warehouse": "Surface de vente",
	"back_store_warehouse": "Réserve",
	"quarantine_warehouse": "Quarantaine",
}

SELLING_PRICE_LIST = "Vente TTC"
BUYING_PRICE_LIST = "Achat TTC"
SALES_TAXES_TITLE = "TVA incluse (ventes)"
PURCHASE_TAXES_TITLE = "TVA incluse (achats)"
WALK_IN_CUSTOMER = "Client comptoir"
ITEM_NAMING_SERIES = "ART-.#####"

# Payment methods at the counter: (name, ERPNext type, CGNC account number in chart_ma).
PAYMENT_MODES = {
	"cash": ("Espèces", "Cash", "5161"),
	"card": ("Carte bancaire", "Bank", "5118"),
}
DEFAULT_TILL = "Caisse 1"
CASH_DIFFERENCE_ACCOUNT = "61858"
PETTY_CASH_NUMBER = "61857"

# Paying suppliers: (name, ERPNext type, CGNC account number).
SUPPLIER_PAYMENT_MODES = {
	"transfer": ("Virement bancaire", "Bank", "5141"),
	"cheque": ("Chèque", "Bank", "5141"),
}

# Overheads bought on supplier invoices so their VAT is deductible: (item name, CGNC expense account).
# VAT category defaults to 20 % (overheads); the accountant adjusts per item if needed.
OVERHEAD_ITEMS = [
	("Électricité", "6125"),
	("Eau", "6125"),
	("Internet et téléphone", "6145"),
	("Emballages et sacs", "6123"),
	("Entretien et nettoyage", "6133"),
	("Honoraires (comptable, conseil)", "6136"),
	("Loyer et charges", "6131"),
	("Publicité", "6144"),
	("Transport sur achats", "6141"),
]


def apply_defaults(company: str, preset_groups: bool = True) -> dict:
	"""Run every setup step for a company and store the result in ParaPilot Settings.

	preset_groups=False keeps a shop's own product families and only adds "Frais généraux"."""
	accounts = ensure_vat_accounts(company)
	templates = ensure_item_tax_templates(company, accounts)
	sales_taxes, purchase_taxes = ensure_taxes_and_charges_templates(company, accounts)
	ensure_item_groups(
		templates, ITEM_GROUPS if preset_groups else [g for g in ITEM_GROUPS if g[0] == "Frais généraux"]
	)
	warehouses = ensure_warehouses(company)
	selling, buying = ensure_price_lists(company)
	ensure_walk_in_customer()
	configure_erpnext(warehouses, selling, buying)
	modes = ensure_payment_modes(company)
	ensure_payment_modes(company, SUPPLIER_PAYMENT_MODES)
	ensure_till(company, DEFAULT_TILL, warehouses["shop_floor_warehouse"], selling, sales_taxes, modes)
	ensure_petty_cash_account(company)
	ensure_overhead_items(company)

	settings = frappe.get_single("ParaPilot Settings")
	settings.company = company
	settings.vat_template_standard = templates["standard"]
	settings.vat_template_reduced = templates["reduced"]
	settings.vat_template_exempt = templates["exempt"]
	settings.sales_taxes_template = sales_taxes
	settings.purchase_taxes_template = purchase_taxes
	settings.selling_price_list = selling
	settings.buying_price_list = buying
	for field, name in warehouses.items():
		settings.set(field, name)
	settings.save(ignore_permissions=True)
	return settings.as_dict()


def _find_account(company: str, account_name: str) -> str | None:
	return frappe.db.get_value("Account", {"company": company, "account_name": account_name, "is_group": 0})


def _taxes_group(company: str) -> str:
	parent = frappe.db.get_value(
		"Account", {"company": company, "account_type": "Tax", "is_group": 1}, order_by="lft desc"
	) or frappe.db.get_value(
		"Account", {"company": company, "root_type": "Liability", "is_group": 1}, order_by="lft asc"
	)
	if not parent:
		frappe.throw(_("No liability account group found for {0}.").format(company))
	return parent


def _ensure_account(company: str, account_name: str) -> str:
	existing = _find_account(company, account_name)
	if existing:
		return existing
	account = frappe.get_doc(
		{
			"doctype": "Account",
			"company": company,
			"account_name": account_name,
			"parent_account": _taxes_group(company),
			"account_type": "Tax",
			"is_group": 0,
		}
	).insert(ignore_permissions=True)
	return account.name


def ensure_vat_accounts(company: str) -> dict[str, dict[int, str]]:
	"""VAT accounts by kind and rate; found in the ParaPilot chart, or created on another chart."""
	return {
		kind: {rate: _ensure_account(company, name.format(rate=rate)) for rate in RATES}
		for kind, name in VAT_ACCOUNT_NAMES.items()
	}


def _upsert(doctype: str, filters: dict, values: dict, child_field: str, rows: list[dict]) -> str:
	name = frappe.db.get_value(doctype, filters)
	doc = frappe.get_doc(doctype, name) if name else frappe.new_doc(doctype)
	doc.update({**filters, **values})
	doc.set(child_field, [])
	for row in rows:
		doc.append(child_field, row)
	doc.save(ignore_permissions=True)
	return doc.name


def ensure_item_tax_templates(company: str, accounts) -> dict[str, str]:
	"""One template per VAT category, listing every VAT account so no other rate leaks in."""
	templates = {}
	for category, (title, rate, deductible_kind) in TEMPLATES.items():
		applies = {accounts["collected"].get(rate), accounts.get(deductible_kind, {}).get(rate)} - {None}
		rows = [
			{"tax_type": account, "tax_rate": rate if account in applies else 0}
			for kind in VAT_ACCOUNT_NAMES
			for account in accounts[kind].values()
		]
		templates[category] = _upsert(
			"Item Tax Template", {"company": company, "title": title}, {}, "taxes", rows
		)
	return templates


def ensure_taxes_and_charges_templates(company: str, accounts) -> tuple[str, str]:
	"""Prices are entered VAT-included, so every VAT row is 'included in basic rate'."""
	sales_rows = [
		{
			"charge_type": "On Net Total",
			"account_head": account,
			"rate": rate,
			"included_in_print_rate": 1,
			"description": f"TVA {rate}%",
		}
		for rate, account in accounts["collected"].items()
	]
	purchase_rows = [
		{
			"category": "Total",
			"add_deduct_tax": "Add",
			"charge_type": "On Net Total",
			"account_head": account,
			"rate": rate,
			"included_in_print_rate": 1,
			"description": f"TVA {rate}%",
		}
		for kind in ("deductible_goods", "deductible_overheads")
		for rate, account in accounts[kind].items()
	]
	sales = _upsert(
		"Sales Taxes and Charges Template",
		{"company": company, "title": SALES_TAXES_TITLE},
		{"is_default": 1},
		"taxes",
		sales_rows,
	)
	purchase = _upsert(
		"Purchase Taxes and Charges Template",
		{"company": company, "title": PURCHASE_TAXES_TITLE},
		{"is_default": 1},
		"taxes",
		purchase_rows,
	)
	return sales, purchase


def ensure_item_groups(templates: dict[str, str], groups: list[tuple[str, str]] = ITEM_GROUPS):
	"""Create the preset groups; an existing group keeps the VAT category the accountant chose."""
	for group_name, category in groups:
		if frappe.db.exists("Item Group", group_name):
			doc = frappe.get_doc("Item Group", group_name)
			if doc.taxes:
				continue
		else:
			doc = frappe.new_doc("Item Group")
			doc.item_group_name = group_name
			doc.parent_item_group = "All Item Groups"
		doc.append("taxes", {"item_tax_template": templates[category]})
		doc.save(ignore_permissions=True)


def ensure_warehouses(company: str) -> dict[str, str]:
	abbr = frappe.get_cached_value("Company", company, "abbr")
	parent = frappe.db.get_value("Warehouse", {"company": company, "is_group": 1}, order_by="lft asc")
	result = {}
	for field, warehouse_name in WAREHOUSES.items():
		name = f"{warehouse_name} - {abbr}"
		if not frappe.db.exists("Warehouse", name):
			frappe.get_doc(
				{
					"doctype": "Warehouse",
					"warehouse_name": warehouse_name,
					"company": company,
					"parent_warehouse": parent,
				}
			).insert(ignore_permissions=True)
		result[field] = name
	return result


def ensure_price_lists(company: str) -> tuple[str, str]:
	currency = frappe.get_cached_value("Company", company, "default_currency")
	for name, selling in ((SELLING_PRICE_LIST, 1), (BUYING_PRICE_LIST, 0)):
		if not frappe.db.exists("Price List", name):
			frappe.get_doc(
				{
					"doctype": "Price List",
					"price_list_name": name,
					"currency": currency,
					"selling": selling,
					"buying": 1 - selling,
					"enabled": 1,
				}
			).insert(ignore_permissions=True)
	return SELLING_PRICE_LIST, BUYING_PRICE_LIST


def ensure_walk_in_customer():
	if frappe.db.exists("Customer", WALK_IN_CUSTOMER):
		return
	frappe.get_doc(
		{
			"doctype": "Customer",
			"customer_name": WALK_IN_CUSTOMER,
			"customer_type": "Individual",
			"customer_group": frappe.db.get_single_value("Selling Settings", "customer_group")
			or frappe.db.get_value("Customer Group", {"is_group": 0}),
			"territory": frappe.db.get_single_value("Selling Settings", "territory")
			or frappe.db.get_value("Territory", {"is_group": 0}),
		}
	).insert(ignore_permissions=True)


def configure_erpnext(warehouses: dict[str, str], selling: str, buying: str):
	stock = frappe.get_single("Stock Settings")
	stock.default_warehouse = warehouses["shop_floor_warehouse"]
	stock.allow_negative_stock = 0
	# Batches with expiry dates, picked first expired, first out at the counter.
	stock.enable_serial_and_batch_no_for_item = 1
	stock.auto_create_serial_and_batch_bundle_for_outward = 1
	stock.pick_serial_and_batch_based_on = "Expiry"
	# Items are numbered ART-00001...; the barcode is what people scan, not the code.
	stock.item_naming_by = "Naming Series"
	stock.save(ignore_permissions=True)
	make_property_setter("Item", "naming_series", "options", ITEM_NAMING_SERIES, "Text")
	make_property_setter("Item", "naming_series", "default", ITEM_NAMING_SERIES, "Text")

	# Invoices and receipts say "DH", as Moroccan shops write it.
	frappe.db.set_value("Currency", "MAD", {"symbol": "DH", "enabled": 1})
	frappe.db.set_single_value("Selling Settings", "selling_price_list", selling)
	# A supplier may invoice another price than the delivery note: ParaPilot highlights it (1 % check)
	# instead of ERPNext locking the rate, and stock is revalued at the invoiced price.
	frappe.db.set_single_value("Buying Settings", "maintain_same_rate", 0)
	frappe.db.set_single_value("Buying Settings", "set_landed_cost_based_on_purchase_invoice_rate", 1)
	# Damaged units go back to the supplier (draft return): invoices cover accepted units only.
	frappe.db.set_single_value("Buying Settings", "bill_for_rejected_quantity_in_purchase_invoice", 0)
	# Up to 10 % above the purchase order is accepted (and highlighted above 1 %); beyond is refused.
	if not frappe.db.get_single_value("Accounts Settings", "over_billing_allowance"):
		frappe.db.set_single_value("Accounts Settings", "over_billing_allowance", 10)
	# The same supplier invoice number cannot be entered twice.
	frappe.db.set_single_value("Accounts Settings", "check_supplier_invoice_uniqueness", 1)
	frappe.db.set_single_value("Buying Settings", "buying_price_list", buying)
	frappe.db.set_single_value("Accounts Settings", "round_row_wise_tax", 1)
	# Each ticket is a paid Sales Invoice that moves stock at once (ERPNext v16 default POS flow).
	frappe.db.set_single_value("POS Settings", "invoice_type", "Sales Invoice")
	frappe.db.set_single_value("System Settings", "currency_precision", "2")
	frappe.db.set_single_value("System Settings", "rounding_method", "Commercial Rounding")


def ensure_payment_modes(company: str, modes: dict | None = None) -> dict[str, str]:
	"""Cash posts to the till's cash account; card payments wait in 5118 until the bank settles them."""
	from parapilot.setup.company import account_by_number

	defaults = frappe.get_cached_value(
		"Company", company, ["default_cash_account", "default_bank_account"], as_dict=True
	)
	result = {}
	for key, (name, mode_type, number) in (modes or PAYMENT_MODES).items():
		account = account_by_number(company, number)
		if account and frappe.db.get_value("Account", account, "account_type") not in ("Cash", "Bank"):
			# Sites created before the card account was typed "Bank" in chart_ma.
			frappe.db.set_value("Account", account, "account_type", mode_type)
		account = account or (
			defaults.default_cash_account if mode_type == "Cash" else defaults.default_bank_account
		)
		doc = (
			frappe.get_doc("Mode of Payment", name)
			if frappe.db.exists("Mode of Payment", name)
			else frappe.get_doc({"doctype": "Mode of Payment", "mode_of_payment": name, "type": mode_type})
		)
		doc.enabled = 1
		row = next((a for a in doc.accounts if a.company == company), None)
		if not row:
			doc.append("accounts", {"company": company, "default_account": account})
		elif not row.default_account:
			row.default_account = account
		doc.save(ignore_permissions=True)
		result[key] = doc.name
	return result


def ensure_till(
	company: str, name: str, warehouse: str, price_list: str, sales_taxes: str, modes: dict[str, str]
) -> str:
	"""One POS Profile per counter. Existing tills keep their settings."""
	if frappe.db.exists("POS Profile", name):
		return name
	profile = frappe.get_doc(
		{"doctype": "POS Profile", "name": name, **till_values(company, warehouse, price_list, sales_taxes, modes)}
	)
	profile.insert(ignore_permissions=True)
	return profile.name


def till_values(company: str, warehouse: str, price_list: str, sales_taxes: str, modes: dict[str, str]) -> dict:
	"""POS Profile settings ParaPilot's till relies on."""
	from parapilot.setup.company import account_by_number

	company_doc = frappe.get_cached_doc("Company", company)
	return {
		"company": company,
		"warehouse": warehouse,
		"selling_price_list": price_list,
		"currency": company_doc.default_currency,
		"customer": WALK_IN_CUSTOMER,
		"taxes_and_charges": sales_taxes,
		"update_stock": 1,
		"apply_discount_on": "Grand Total",
		"disable_rounded_total": 1,
		"allow_rate_change": 0,
		"allow_discount_change": 1,
		"ignore_pricing_rule": 1,
		"account_for_change_amount": account_by_number(company, PAYMENT_MODES["cash"][2])
		or company_doc.default_cash_account,
		"write_off_account": account_by_number(company, CASH_DIFFERENCE_ACCOUNT)
		or company_doc.write_off_account,
		"write_off_cost_center": company_doc.cost_center,
		"cost_center": company_doc.cost_center,
		"write_off_limit": 1,
		"payments": [
			{"mode_of_payment": modes["cash"], "default": 1, "allow_in_returns": 1},
			{"mode_of_payment": modes["card"], "allow_in_returns": 1},
		],
	}


def ensure_petty_cash_account(company: str) -> str:
	"""Expense account for small cash expenses taken from the till; created on sites set up before it."""
	from parapilot.setup.chart_ma import PETTY_CASH_ACCOUNT
	from parapilot.setup.company import account_by_number

	existing = account_by_number(company, PETTY_CASH_NUMBER) or _find_account(company, PETTY_CASH_ACCOUNT)
	if existing:
		return existing
	parent = frappe.db.get_value(
		"Account", {"company": company, "account_number": "618", "is_group": 1}
	) or frappe.db.get_value("Account", {"company": company, "root_type": "Expense", "is_group": 1}, order_by="lft asc")
	return (
		frappe.get_doc(
			{
				"doctype": "Account",
				"company": company,
				"account_name": PETTY_CASH_ACCOUNT,
				"account_number": PETTY_CASH_NUMBER,
				"parent_account": parent,
				"account_type": "Expense Account",
			}
		)
		.insert(ignore_permissions=True)
		.name
	)


def ensure_overhead_items(company: str):
	"""Non-stock items for overhead invoices, each booked to its CGNC expense account."""
	from parapilot.setup.company import account_by_number

	for item_name, number in OVERHEAD_ITEMS:
		if frappe.db.exists("Item", {"item_name": item_name, "item_group": "Frais généraux"}):
			continue
		frappe.get_doc(
			{
				"doctype": "Item",
				"item_name": item_name,
				"item_group": "Frais généraux",
				"stock_uom": "Nos",
				"is_stock_item": 0,
				"is_sales_item": 0,
				"is_purchase_item": 1,
				"include_item_in_manufacturing": 0,
				"item_defaults": [
					{"company": company, "expense_account": account_by_number(company, number)}
				],
			}
		).insert(ignore_permissions=True)
