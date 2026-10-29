"""Take over a company that already trades on ERPNext: keep its history, move it to the ParaPilot CGNC chart
and apply ParaPilot's defaults. For a shop that used ERPNext before ParaPilot; a new shop uses
company.create_company instead.

Every step is idempotent. Run it with the shop closed: ERPNext refuses to merge accounts while entries are
being posted.

bench --site <site> execute parapilot.setup.adopt.adopt_company --kwargs "{'company': 'Derma Routine'}"
"""

import json

import frappe

from parapilot.setup.chart_ma import CHART
from parapilot.setup.company import DEFAULT_ACCOUNTS, account_by_number, ensure_erpnext_fixtures
from parapilot.setup.defaults import (
	BUYING_PRICE_LIST,
	DEFAULT_TILL,
	PAYMENT_MODES,
	SELLING_PRICE_LIST,
	WALK_IN_CUSTOMER,
	WAREHOUSES,
	apply_defaults,
	till_values,
)

# Accounts of ERPNext's standard chart (name without the company abbreviation) and the CGNC account their
# entries move to. The two sales VAT accounts the shop used in turn both become 44551.
STANDARD_ACCOUNTS = {
	"Debtors": "3421",
	"Cash": "5161",
	"Stock In Hand": "3111",
	"Temporary Opening": "3990",
	"VAT Recoverable on Purchases": "345521",
	"Creditors": "4411",
	"Stock Received But Not Billed": "4417",
	"VAT 20%": "44551",
	"VAT Collected on Sales": "44551",
	"VAT 10%": "44552",
	"Sales": "7111",
	"Cost of Goods Sold": "6111",
	"Stock Adjustment": "6114",
	"Expenses Included In Valuation": "6141",
	"Round Off": "6588",
	"Write Off": "61858",
	"Exchange Gain/Loss": "6331",
	"Capital Stock": "1111",
	"Retained Earnings": "1161",
}

# Standard records renamed to ParaPilot's, so existing documents keep pointing at them.
STANDARD_WAREHOUSE = "Main Store"
STANDARD_PRICE_LISTS = {"Retail TTC": SELLING_PRICE_LIST, "Standard Buying": BUYING_PRICE_LIST}
STANDARD_CUSTOMER = "Walk-in Customer"
STANDARD_PAYMENT_MODES = {"Cash": "cash", "Credit Card": "card"}
STANDARD_TILL = "Main Store POS"

# Families whose products have no expiry date: no lot to enter at receiving.
NO_BATCH_GROUPS = ("Accessories", "Accessoires")


def adopt_company(company: str) -> dict:
	ensure_erpnext_fixtures()
	abbr = frappe.get_cached_value("Company", company, "abbr")
	report = {"merged": adopt_chart(company, abbr)}
	report["accounts_kept"] = remove_standard_accounts(company)
	adopt_records(company, abbr)

	settings = apply_defaults(company, preset_groups=False)
	modes = {key: PAYMENT_MODES[key][0] for key in PAYMENT_MODES}
	till = frappe.get_doc("POS Profile", DEFAULT_TILL)
	till.update(
		till_values(
			company,
			settings["shop_floor_warehouse"],
			settings["selling_price_list"],
			settings["sales_taxes_template"],
			modes,
		)
	)
	till.save(ignore_permissions=True)

	report["templates_disabled"] = disable_other_tax_templates(company, settings)
	report["receipts_given_vat"], report["receipts_not_fixed"] = fix_receipts_without_vat(company)
	report["groups_given_vat"] = set_vat_on_groups(settings["vat_template_standard"])
	report["items_with_batches"] = enable_batches()
	remove_unused_warehouses(company, abbr)

	from parapilot.api.settings import SETUP_STEPS

	# The accountant still confirms the VAT settings in ParaPilot.
	done = [step for step in SETUP_STEPS if step != "vat"]
	frappe.db.set_single_value("ParaPilot Settings", "setup_steps_done", json.dumps(sorted(done)))
	frappe.clear_cache()
	return report


def adopt_chart(company: str, abbr: str) -> list[str]:
	"""Add the CGNC chart next to the standard one, then merge each used standard account into its CGNC
	account: entries, links and balances follow."""
	from erpnext.accounts.doctype.account.account import merge_account
	from erpnext.accounts.doctype.account.chart_of_accounts.chart_of_accounts import create_charts

	if not account_by_number(company, "5161"):
		frappe.local.flags.ignore_root_company_validation = True
		try:
			create_charts(company, custom_chart=CHART)
		finally:
			frappe.local.flags.ignore_root_company_validation = False
	add_missing_chart_accounts(company)
	# A custom chart leaves the currency empty; ERPNext only merges accounts of the same currency.
	frappe.db.sql(
		"update tabAccount set account_currency = %s where company = %s and ifnull(account_currency, '') = ''",
		(frappe.get_cached_value("Company", company, "default_currency"), company),
	)

	merged = []
	for name, number in STANDARD_ACCOUNTS.items():
		old = f"{name} - {abbr}"
		if not frappe.db.exists("Account", old):
			continue
		target = account_by_number(company, number)
		merge_account(old, target)
		merged.append(f"{old} → {target}")

	company_doc = frappe.get_doc("Company", company)
	for field, number in DEFAULT_ACCOUNTS.items():
		if company_doc.meta.has_field(field):
			company_doc.set(field, account_by_number(company, number))
	# Other defaults (fixed assets, deferred revenue...) left on a standard account are cleared, so the
	# standard chart can go; ERPNext asks for them if the shop ever uses those features.
	for df in company_doc.meta.get("fields", {"fieldtype": "Link", "options": "Account"}):
		value = company_doc.get(df.fieldname)
		if value and not frappe.db.get_value("Account", value, "account_number"):
			company_doc.set(df.fieldname, None)
	company_doc.round_off_cost_center = company_doc.round_off_cost_center or company_doc.cost_center
	company_doc.save(ignore_permissions=True)
	return merged


def add_missing_chart_accounts(company: str):
	"""Accounts added to chart_ma.CHART after the company got its chart, created under their parent."""

	def walk(children: dict, parent: str | None, root_type: str | None):
		for name, node in children.items():
			if not isinstance(node, dict):
				continue
			root_type = node.get("root_type", root_type)
			number = node.get("account_number")
			existing = (
				frappe.db.get_value("Account", {"company": company, "account_number": number})
				if number
				else frappe.db.get_value("Account", {"company": company, "account_name": name, "parent_account": ["in", ["", None]]})
			)
			if not existing and parent:
				existing = (
					frappe.get_doc(
						{
							"doctype": "Account",
							"company": company,
							"account_name": name,
							"account_number": number,
							"parent_account": parent,
							"is_group": node.get("is_group", 0),
							"root_type": root_type,
							"account_type": node.get("account_type"),
						}
					)
					.insert(ignore_permissions=True)
					.name
				)
			if existing:
				walk(node, existing, root_type)

	walk(CHART, None, None)


def remove_standard_accounts(company: str) -> list[str]:
	"""Delete what is left of the standard chart; an account still used somewhere is kept and listed."""
	accounts = frappe.get_all("Account", filters={"company": company}, fields=["name", "lft", "rgt"], order_by="lft desc")
	cgnc_roots = frappe.get_all(
		"Account",
		filters={"company": company, "parent_account": ["in", ["", None]], "account_name": ["in", list(CHART)]},
		fields=["lft", "rgt"],
	)
	# Decided before deleting anything: each deletion shifts the tree's lft/rgt numbers.
	standard = [a.name for a in accounts if not any(r.lft <= a.lft and a.rgt <= r.rgt for r in cgnc_roots)]
	kept = []
	for name in standard:  # children before their parents
		frappe.db.savepoint("remove_account")
		try:
			frappe.delete_doc("Account", name, ignore_permissions=True)
		except frappe.ValidationError:
			frappe.db.rollback(save_point="remove_account")
			frappe.clear_messages()
			kept.append(name)
	return kept


def _rename(doctype: str, old: str, new: str, **fields):
	if frappe.db.exists(doctype, old) and not frappe.db.exists(doctype, new):
		frappe.rename_doc(doctype, old, new, force=True)
	if fields and frappe.db.exists(doctype, new):
		frappe.db.set_value(doctype, new, fields)


def adopt_records(company: str, abbr: str):
	"""Rename the standard warehouse, price lists, walk-in customer, payment methods and till to ParaPilot's,
	so the shop's history stays attached to them."""
	shop_floor = WAREHOUSES["shop_floor_warehouse"]
	_rename("Warehouse", f"{STANDARD_WAREHOUSE} - {abbr}", f"{shop_floor} - {abbr}", warehouse_name=shop_floor)
	# Products default to the shop floor, not to ERPNext's "Stores".
	frappe.db.sql(
		"""update `tabItem Default` set default_warehouse = %(shop_floor)s
		where company = %(company)s and ifnull(default_warehouse, '') not in %(ours)s""",
		{
			"shop_floor": f"{shop_floor} - {abbr}",
			"company": company,
			"ours": tuple(f"{name} - {abbr}" for name in WAREHOUSES.values()),
		},
	)
	for old, new in STANDARD_PRICE_LISTS.items():
		_rename("Price List", old, new, price_list_name=new)
	_rename("Customer", STANDARD_CUSTOMER, WALK_IN_CUSTOMER, customer_name=WALK_IN_CUSTOMER)
	for old, key in STANDARD_PAYMENT_MODES.items():
		name, mode_type, number = PAYMENT_MODES[key]
		_rename("Mode of Payment", old, name, mode_of_payment=name, type=mode_type)
		if frappe.db.exists("Mode of Payment", name):
			# Card payments wait in 5118 until the bank settles them; cash goes to the till's 5161.
			frappe.db.set_value(
				"Mode of Payment Account",
				{"parent": name, "company": company},
				"default_account",
				account_by_number(company, number),
			)
	_rename("POS Profile", STANDARD_TILL, DEFAULT_TILL)


def fix_receipts_without_vat(company: str) -> tuple[int, list[str]]:
	"""Delivery notes typed in ERPNext without VAT valued the stock VAT included. Each one not yet invoiced
	is corrected the way an owner does it in ParaPilot: replaced at its own date with the VAT-included
	purchase template, so the stock and the cost of everything sold since are valued without VAT.
	Returns how many were fixed and why the others were not."""
	from erpnext.stock.doctype.repost_item_valuation.repost_item_valuation import repost_entries

	from parapilot.api.purchasing import receipt_has_vat

	names = [
		r.name
		for r in frappe.get_all(
			"Purchase Receipt",
			filters={"company": company, "docstatus": 1, "is_return": 0},
			fields=["name", "taxes_and_charges", "total_taxes_and_charges"],
			order_by="posting_date asc, posting_time asc, creation asc",
		)
		if not receipt_has_vat(r.taxes_and_charges, r.total_taxes_and_charges)
	]
	# These corrections keep every quantity. Plain ERPNext allowed selling stock not yet received, so the
	# history can hold a moment of negative stock that would refuse the cancellation; it is tolerated for
	# this run only.
	negative_allowed = frappe.db.get_single_value("Stock Settings", "allow_negative_stock")
	frappe.db.set_single_value("Stock Settings", "allow_negative_stock", 1)
	frappe.flags.pp_repost_at_end = True
	try:
		fixed, not_fixed = _correct_receipts(names)
	finally:
		frappe.db.set_single_value("Stock Settings", "allow_negative_stock", negative_allowed)
		frappe.flags.pp_repost_at_end = False
	# Recompute the cost of what was sold since, once, now rather than at the next hourly run.
	restart_failed_reposts()
	repost_entries()
	return fixed, not_fixed


def restart_failed_reposts():
	"""Cost recalculations that failed (for instance two running at once) are queued again."""
	for name in frappe.get_all("Repost Item Valuation", filters={"docstatus": 1, "status": "Failed"}, pluck="name"):
		frappe.get_doc("Repost Item Valuation", name).restart_reposting()


def _correct_receipts(names: list[str]) -> tuple[int, list[str]]:
	from parapilot.api.purchasing import get_receipt_draft, submit_receipt

	fixed, not_fixed = 0, []
	for name in names:
		frappe.db.savepoint("fix_receipt")
		try:
			draft = get_receipt_draft(correct=name)
			submit_receipt(
				{
					"supplier": draft["supplier"],
					"supplier_delivery_note": draft["supplier_delivery_note"],
					"warehouse": draft["warehouse"],
					"purchase_order": draft["purchase_order"],
					"corrects": name,
					"lines": draft["lines"],
				}
			)
			fixed += 1
		except frappe.ValidationError as e:
			frappe.db.rollback(save_point="fix_receipt")
			frappe.clear_messages()
			not_fixed.append(f"{name}: {frappe.utils.strip_html(str(e))}")
	return fixed, not_fixed


def disable_other_tax_templates(company: str, settings: dict) -> list[str]:
	"""Only ParaPilot's VAT templates stay selectable; older ones remain on past documents."""
	keep = {
		settings["vat_template_standard"],
		settings["vat_template_reduced"],
		settings["vat_template_exempt"],
		settings["sales_taxes_template"],
		settings["purchase_taxes_template"],
	} | set(frappe.get_all("Item Tax Template", filters={"company": company, "title": ["like", "%frais généraux%"]}, pluck="name"))
	disabled = []
	for doctype in ("Item Tax Template", "Sales Taxes and Charges Template", "Purchase Taxes and Charges Template"):
		for name in frappe.get_all(doctype, filters={"company": company, "disabled": 0}, pluck="name"):
			if name not in keep:
				frappe.db.set_value(doctype, name, {"disabled": 1, **({"is_default": 0} if doctype != "Item Tax Template" else {})})
				disabled.append(name)
	return disabled


def set_vat_on_groups(template: str) -> int:
	"""Families without a VAT category get TVA 20 %; the accountant changes the exceptions in Settings."""
	count = 0
	for name in frappe.get_all("Item Group", filters={"is_group": 0}, pluck="name"):
		doc = frappe.get_doc("Item Group", name)
		if doc.taxes:
			continue
		doc.append("taxes", {"item_tax_template": template})
		doc.save(ignore_permissions=True)
		count += 1
	return count


def enable_batches() -> int:
	"""Lot and expiry on every stock product that has never moved. ERPNext refuses the change on a
	product with stock history; those are converted at the next stock count."""
	items = frappe.db.sql_list(
		"""select name from tabItem i
		where is_stock_item = 1 and has_batch_no = 0 and item_group not in %(skip)s
		and not exists (select 1 from `tabStock Ledger Entry` sle where sle.item_code = i.name)""",
		{"skip": NO_BATCH_GROUPS},
	)
	for chunk in range(0, len(items), 1000):
		frappe.db.sql(
			"update tabItem set has_batch_no = 1, has_expiry_date = 1 where name in %(names)s",
			{"names": items[chunk : chunk + 1000]},
		)
	return len(items)


def remove_unused_warehouses(company: str, abbr: str):
	"""ERPNext's manufacturing warehouses, when nothing was ever stored there."""
	for name in ("Finished Goods", "Goods In Transit", "Stores", "Work In Progress"):
		warehouse = f"{name} - {abbr}"
		if not frappe.db.exists("Warehouse", warehouse):
			continue
		frappe.db.savepoint("remove_warehouse")
		try:
			frappe.delete_doc("Warehouse", warehouse, ignore_permissions=True)
		except frappe.ValidationError:
			frappe.db.rollback(save_point="remove_warehouse")
			frappe.clear_messages()
