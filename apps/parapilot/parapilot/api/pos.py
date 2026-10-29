"""Point of sale: tills, the device catalog, sales, receipts and closing.

Every call runs as the logged-in person, so ERPNext's permissions apply. Each ticket is a paid Sales
Invoice (ERPNext v16's POS flow) that moves stock immediately; batches are picked by ERPNext, first
expired first out.
"""

import json
import re
from datetime import datetime
from zoneinfo import ZoneInfo

import frappe
from frappe import _
from frappe.utils import cint, flt, get_datetime, get_system_timezone, getdate, now_datetime, today

from parapilot.api.catalog import _item_vat
from parapilot.utils import get_app_roles, get_settings, require_app_role

SELLERS = ("owner", "manager", "cashier")
CLIENT_ID = re.compile(r"[0-9A-Z]{10,26}")


class TillClosedError(frappe.ValidationError):
	pass


def _discount_limit() -> float | None:
	"""Owners and managers have no limit; cashiers are capped by ParaPilot Settings."""
	if {"owner", "manager"} & set(get_app_roles()):
		return None
	return flt(get_settings().cashier_discount_limit)


def _open_entry(user: str | None = None):
	return frappe.db.get_value(
		"POS Opening Entry",
		{"user": user or frappe.session.user, "status": "Open", "docstatus": 1},
		["name", "pos_profile", "period_start_date", "company"],
		as_dict=True,
	)


def _payment_modes(pos_profile: str) -> list[dict]:
	profile = frappe.get_cached_doc("POS Profile", pos_profile)
	return [
		{
			"mode_of_payment": p.mode_of_payment,
			"type": frappe.get_cached_value("Mode of Payment", p.mode_of_payment, "type"),
			"default": cint(p.default),
		}
		for p in profile.payments
	]


@frappe.whitelist()
def get_till_status() -> dict:
	"""The person's open till, if any, and every till of the shop with who has it open."""
	require_app_role(*SELLERS)
	settings = get_settings()
	open_by = {
		r.pos_profile: r.user
		for r in frappe.get_all(
			"POS Opening Entry", filters={"status": "Open", "docstatus": 1}, fields=["pos_profile", "user"]
		)
	}
	tills = [
		{"name": name, "open_by": open_by.get(name)}
		for name in frappe.get_all(
			"POS Profile", filters={"company": settings.company, "disabled": 0}, pluck="name", order_by="name"
		)
	]
	opening = _open_entry()
	current = None
	if opening:
		entry = frappe.get_doc("POS Opening Entry", opening.name)
		current = {
			"name": entry.name,
			"pos_profile": entry.pos_profile,
			"period_start_date": str(entry.period_start_date),
			# ERPNext refuses sales on a till opened another day: it must be closed first.
			"outdated": getdate(entry.period_start_date) != getdate(today()),
			"opening_amounts": {d.mode_of_payment: flt(d.opening_amount) for d in entry.balance_details},
			"payment_modes": _payment_modes(entry.pos_profile),
		}
	return {"tills": tills, "opening": current, "discount_limit": _discount_limit()}


@frappe.whitelist(methods=["POST"])
def open_till(pos_profile: str, cash_float: float = 0) -> dict:
	require_app_role(*SELLERS)
	if _open_entry():
		frappe.throw(_("You already have an open till. Close it first."))
	if flt(cash_float) < 0:
		frappe.throw(_("The starting cash cannot be negative."))

	profile = frappe.get_doc("POS Profile", pos_profile)
	user = frappe.session.user
	if profile.applicable_for_users and user not in {u.user for u in profile.applicable_for_users}:
		# ERPNext lists the cashiers allowed on a till; ParaPilot roles already decide who may sell.
		profile.append("applicable_for_users", {"user": user})
		profile.save(ignore_permissions=True)

	cash_modes = {m["mode_of_payment"] for m in _payment_modes(pos_profile) if m["type"] == "Cash"}
	entry = frappe.get_doc(
		{
			"doctype": "POS Opening Entry",
			"pos_profile": pos_profile,
			"company": profile.company,
			"user": user,
			"period_start_date": now_datetime(),
			"posting_date": today(),
			"balance_details": [
				{
					"mode_of_payment": p.mode_of_payment,
					"opening_amount": flt(cash_float, 2) if p.mode_of_payment in cash_modes else 0,
				}
				for p in profile.payments
			],
		}
	)
	entry.insert()
	entry.submit()
	return get_till_status()


@frappe.whitelist()
def get_catalog(pos_profile: str) -> dict:
	"""Everything the till needs to sell without asking the server: cached on the device."""
	require_app_role(*SELLERS)
	frappe.has_permission("POS Profile", "read", doc=pos_profile, throw=True)
	settings = get_settings()
	profile = frappe.get_cached_doc("POS Profile", pos_profile)

	items = frappe.get_all(
		"Item",
		filters={"disabled": 0, "is_sales_item": 1, "has_variants": 0, "pp_is_tester": 0, "is_fixed_asset": 0},
		fields=["name", "item_name", "brand", "item_group", "image", "has_batch_no", "is_stock_item"],
		order_by="item_name asc",
		limit_page_length=0,
	)
	codes = [i.name for i in items] or [""]

	prices = {}
	for p in frappe.get_all(
		"Item Price",
		filters={"price_list": profile.selling_price_list, "item_code": ["in", codes]},
		fields=["item_code", "price_list_rate", "customer"],
		order_by="valid_from desc",
	):
		if not p.customer:
			prices.setdefault(p.item_code, p.price_list_rate)

	barcodes: dict[str, list[str]] = {}
	for b in frappe.get_all(
		"Item Barcode", filters={"parenttype": "Item", "parent": ["in", codes]}, fields=["parent", "barcode"]
	):
		barcodes.setdefault(b.parent, []).append(b.barcode)

	stock = {
		b.item_code: flt(b.actual_qty)
		for b in frappe.get_all(
			"Bin",
			filters={"item_code": ["in", codes], "warehouse": profile.warehouse},
			fields=["item_code", "actual_qty"],
		)
	}
	vat = _item_vat([i.name for i in items], {i.name: i.item_group for i in items}, settings.company)
	taxes = frappe.get_cached_doc("Sales Taxes and Charges Template", profile.taxes_and_charges)

	return {
		"pos_profile": pos_profile,
		"generated_at": str(now_datetime()),
		# Offline receipts need the full legal header and the receipt language.
		"company": _company_block(profile.company),
		"receipt_language": settings.receipt_language or "fr",
		"rounding_method": frappe.get_system_settings("rounding_method"),
		"tax_rows": [flt(t.rate) for t in taxes.taxes],
		"payment_modes": _payment_modes(pos_profile),
		"items": [
			{
				"item_code": i.name,
				"item_name": i.item_name,
				"brand": i.brand,
				"item_group": i.item_group,
				"image": i.image,
				"barcodes": barcodes.get(i.name, []),
				"price": prices.get(i.name),
				"vat_rate": vat[i.name]["rate"],
				"stock": stock.get(i.name, 0) if i.is_stock_item else None,
			}
			for i in items
		],
	}


def _shop_time(iso: str | None) -> datetime | None:
	"""The device sends UTC (ISO 8601); ERPNext stores naive times in the site's timezone."""
	if not iso:
		return None
	try:
		moment = datetime.fromisoformat(iso)
	except ValueError:
		return None
	if moment.tzinfo:
		moment = moment.astimezone(ZoneInfo(get_system_timezone())).replace(tzinfo=None)
	return moment


def _parse_sale(sale) -> frappe._dict:
	data = frappe._dict(json.loads(sale) if isinstance(sale, str) else sale)
	if not CLIENT_ID.fullmatch(data.client_id or ""):
		frappe.throw(_("Invalid sale ID."))
	if not data.lines:
		frappe.throw(_("The cart is empty."))
	return data


@frappe.whitelist(methods=["POST"])
def submit_sale(sale: str | dict) -> dict:
	"""Record a sale made at the till. Idempotent: the device's sale ID is unique in ERPNext, so a
	retry after a lost connection returns the first invoice instead of creating a second one."""
	require_app_role(*SELLERS)
	data = _parse_sale(sale)

	existing = frappe.db.get_value("Sales Invoice", {"pp_client_uuid": data.client_id}, "name")
	if existing:
		return {**get_receipt(existing), "duplicate": True}

	opening = _open_entry()
	if not opening:
		frappe.throw(_("Open a till before selling."), TillClosedError)
	if data.pos_profile and data.pos_profile != opening.pos_profile:
		frappe.throw(_("This sale was made on another till."), TillClosedError)

	limit = _discount_limit()
	profile = frappe.get_cached_doc("POS Profile", opening.pos_profile)
	if data.customer and not frappe.db.exists("Customer", {"name": data.customer, "disabled": 0}):
		frappe.throw(_("Customer {0} not found.").format(data.customer))
	si = frappe.new_doc("Sales Invoice")
	si.update(
		{
			"company": opening.company,
			"is_pos": 1,
			"is_created_using_pos": 1,
			"pos_profile": opening.pos_profile,
			"customer": data.customer or profile.customer,
			"update_stock": 1,
			"disable_rounded_total": 1,
			"pp_client_uuid": data.client_id,
		}
	)
	sold_at = _shop_time(data.sold_at)
	if sold_at and getdate(sold_at) == getdate(today()):
		# An offline sale keeps the time it was made, but never before its till opened or in the
		# future: a device clock running behind would otherwise drop it from the closing (Z) report.
		opened = get_datetime(opening.period_start_date)
		sold_at = min(max(sold_at, opened), now_datetime())
		si.set_posting_time = 1
		si.posting_date = getdate(sold_at)
		si.posting_time = sold_at.strftime("%H:%M:%S.%f")

	for line in data.lines:
		if flt(line.get("qty")) <= 0:
			frappe.throw(_("Quantities must be positive."))
		si.append("items", {"item_code": line["item_code"], "qty": flt(line["qty"])})
	si.set_missing_values()

	review = []
	for row, line in zip(si.items, data.lines):
		shown, rate = flt(line["price"], 2), flt(line["rate"], 2)
		if shown <= 0 or rate < 0 or rate > shown:
			frappe.throw(_("Invalid price for {0}.").format(row.item_code))
		discount = (shown - rate) / shown * 100
		if limit is not None and discount > limit + 0.01:
			frappe.throw(_("Discount above your limit of {0}% on {1}.").format(limit, row.item_name))
		catalog_price = flt(row.price_list_rate, 2)
		if catalog_price and catalog_price != shown:
			review.append(_("{0}: sold at {1}, catalog price {2}").format(row.item_name, shown, catalog_price))
		# The customer pays the price shown on the till; the till computed the discounted rate.
		row.price_list_rate = shown
		row.rate = rate
		row.discount_percentage = flt(discount, 3)
		row.discount_amount = flt(shown - rate, 2)
	if review:
		si.pp_price_review = "\n".join(review)

	si.calculate_taxes_and_totals()
	paid = {p["mode_of_payment"]: flt(p["amount"], 2) for p in data.payments or []}
	unknown = set(paid) - {p.mode_of_payment for p in si.payments}
	if unknown:
		frappe.throw(_("Payment method not available on this till: {0}").format(", ".join(unknown)))
	for p in si.payments:
		p.amount = paid.get(p.mode_of_payment, 0)
		p.base_amount = p.amount
	si.calculate_taxes_and_totals()

	try:
		si.insert()
		si.submit()
	except frappe.UniqueValidationError:
		# Two retries of the same sale arrived together: the other one won.
		frappe.db.rollback()
		name = frappe.db.get_value("Sales Invoice", {"pp_client_uuid": data.client_id}, "name")
		if not name:
			raise
		return {**get_receipt(name), "duplicate": True}
	return get_receipt(si.name)


def _vat_by_rate(invoices: list) -> list[dict]:
	"""HT base and VAT per rate over one or more invoices, as invoices and the Z report show them."""
	rate_of_account = {}
	buckets: dict[float, dict] = {}
	for inv in invoices:
		for t in inv.taxes:
			rate_of_account[t.account_head] = flt(t.rate)
		for item in inv.items:
			item_rate = flt(
				max(json.loads(item.item_tax_rate or "{}").values(), default=0)
				if item.item_tax_rate
				else 0
			)
			bucket = buckets.setdefault(item_rate, {"rate": item_rate, "ht": 0.0, "vat": 0.0})
			bucket["ht"] += flt(item.net_amount)
		for t in inv.taxes:
			if flt(t.tax_amount):
				bucket = buckets.setdefault(rate_of_account[t.account_head], {"rate": flt(t.rate), "ht": 0.0, "vat": 0.0})
				bucket["vat"] += flt(t.tax_amount)
	return [
		{"rate": b["rate"], "ht": flt(b["ht"], 2), "vat": flt(b["vat"], 2)}
		for b in sorted(buckets.values(), key=lambda b: -b["rate"])
	]


def _company_block(company: str) -> dict:
	c = frappe.get_cached_doc("Company", company)
	address = frappe.db.get_value(
		"Dynamic Link",
		{"link_doctype": "Company", "link_name": company, "parenttype": "Address"},
		"parent",
	)
	addr = frappe.db.get_value("Address", address, ["address_line1", "address_line2", "city", "phone"], as_dict=True) if address else None
	return {
		"name": c.company_name,
		"address": ", ".join(filter(None, [addr.address_line1, addr.address_line2, addr.city])) if addr else None,
		"phone": (addr.phone if addr else None) or c.phone_no,
		"ice": c.get("pp_ice"),
		"if": c.get("pp_if"),
		"rc": c.get("pp_rc"),
		"tp": c.get("pp_tp"),
	}


@frappe.whitelist()
def get_receipt(name: str) -> dict:
	"""Receipt data: legal IDs, lines, VAT by rate, totals and payments (CGI art. 145)."""
	inv = frappe.get_doc("Sales Invoice", name)
	inv.check_permission("read")
	walk_in = frappe.get_cached_value("POS Profile", inv.pos_profile, "customer") if inv.pos_profile else None
	customer = None
	if inv.customer != walk_in:
		address = (
			frappe.db.get_value("Address", inv.customer_address, ["address_line1", "city"], as_dict=True)
			if inv.customer_address
			else None
		)
		customer = {
			"name": inv.customer_name,
			"ice": frappe.db.get_value("Customer", inv.customer, "pp_ice"),
			"address": ", ".join(filter(None, [address.address_line1, address.city])) if address else None,
		}
	return {
		"name": inv.name,
		"client_id": inv.pp_client_uuid,
		"posting_date": str(inv.posting_date),
		"posting_time": str(inv.posting_time).split(".")[0],
		"cashier": frappe.utils.get_fullname(inv.owner),
		"pos_profile": inv.pos_profile,
		"is_return": inv.is_return,
		"return_against": inv.return_against,
		"company": _company_block(inv.company),
		"customer": customer,
		"lines": [
			{
				"item_code": i.item_code,
				"item_name": i.item_name,
				"qty": i.qty,
				"price": i.price_list_rate,
				"rate": i.rate,
				"discount_percent": i.discount_percentage,
				"amount": i.amount,
			}
			for i in inv.items
		],
		"vat_by_rate": _vat_by_rate([inv]),
		"totals": {
			"ttc": inv.grand_total,
			"ht": inv.net_total,
			"vat": inv.total_taxes_and_charges,
			"discount": flt(sum(flt(i.discount_amount) * flt(i.qty) for i in inv.items), 2),
		},
		"payments": [{"mode_of_payment": p.mode_of_payment, "amount": p.amount} for p in inv.payments if p.amount],
		"paid": inv.paid_amount,
		"change": inv.change_amount,
		"price_review": inv.pp_price_review,
	}


def _closing_draft(opening_name: str):
	from erpnext.accounts.doctype.pos_closing_entry.pos_closing_entry import make_closing_entry_from_opening

	opening = frappe.get_doc("POS Opening Entry", opening_name)
	closing = make_closing_entry_from_opening(opening)
	opening_amounts = {d.mode_of_payment: flt(d.opening_amount) for d in opening.balance_details}
	present = {r.mode_of_payment for r in closing.payment_reconciliation}
	for mode in opening_amounts:
		if mode not in present:
			closing.append("payment_reconciliation", {"mode_of_payment": mode, "expected_amount": 0})
	cash_out = sum(c["amount"] for c in _cash_outs(opening_name))
	cash_modes = {m["mode_of_payment"] for m in _payment_modes(opening.pos_profile) if m["type"] == "Cash"}
	for row in closing.payment_reconciliation:
		row.opening_amount = opening_amounts.get(row.mode_of_payment, 0)
		row.expected_amount = flt(flt(row.expected_amount) + row.opening_amount, 2)
		if row.mode_of_payment in cash_modes and cash_out:
			# Cash taken out for small expenses is no longer in the drawer.
			row.expected_amount = flt(row.expected_amount - cash_out, 2)
			cash_out = 0
	return closing


@frappe.whitelist()
def get_closing_preview() -> dict:
	"""What the drawer and card terminal should show, before the cashier counts."""
	require_app_role(*SELLERS)
	opening = _open_entry()
	if not opening:
		frappe.throw(_("No open till."), TillClosedError)
	closing = _closing_draft(opening.name)
	return {
		"opening": opening.name,
		"pos_profile": opening.pos_profile,
		"cash_outs": _cash_outs(opening.name),
		"tickets": len(closing.sales_invoices),
		"grand_total": flt(closing.grand_total, 2),
		"expected": [
			{
				"mode_of_payment": r.mode_of_payment,
				"type": frappe.get_cached_value("Mode of Payment", r.mode_of_payment, "type"),
				"opening": r.opening_amount,
				"expected": r.expected_amount,
			}
			for r in closing.payment_reconciliation
		],
	}


@frappe.whitelist(methods=["POST"])
def close_till(counted: str | dict) -> dict:
	"""Close the cashier's own till with the amounts counted. The Z report cannot change afterwards:
	the POS Closing Entry is submitted."""
	require_app_role(*SELLERS)
	counted = json.loads(counted) if isinstance(counted, str) else counted
	opening = _open_entry()
	if not opening:
		frappe.throw(_("No open till."), TillClosedError)
	closing = _closing_draft(opening.name)
	for row in closing.payment_reconciliation:
		row.closing_amount = flt(counted.get(row.mode_of_payment), 2)
		row.difference = flt(row.closing_amount - row.expected_amount, 2)
	closing.insert()
	closing.submit()
	return get_z_report(closing.name)


@frappe.whitelist()
def get_z_report(name: str) -> dict:
	closing = frappe.get_doc("POS Closing Entry", name)
	closing.check_permission("read")
	invoices = [frappe.get_doc("Sales Invoice", r.sales_invoice) for r in closing.sales_invoices]
	sales = [i for i in invoices if not i.is_return]
	returns = [i for i in invoices if i.is_return]
	return {
		"name": closing.name,
		"pos_profile": closing.pos_profile,
		"cashier": frappe.utils.get_fullname(closing.user),
		"period_start": str(closing.period_start_date),
		"period_end": str(closing.period_end_date),
		"company": _company_block(closing.company),
		"tickets": len(sales),
		"grand_total": flt(closing.grand_total, 2),
		"net_total": flt(closing.net_total, 2),
		"vat_total": flt(closing.total_taxes_and_charges, 2),
		"vat_by_rate": _vat_by_rate(invoices),
		"returns": {"count": len(returns), "total": flt(sum(i.grand_total for i in returns), 2)},
		"discounts": flt(
			sum(flt(it.discount_amount) * flt(it.qty) for i in invoices for it in i.items), 2
		),
		"payments": [
			{
				"mode_of_payment": r.mode_of_payment,
				"opening": flt(r.opening_amount, 2),
				"expected": flt(r.expected_amount, 2),
				"counted": flt(r.closing_amount, 2),
				"difference": flt(r.difference, 2),
			}
			for r in closing.payment_reconciliation
		],
		"price_reviews": [i.name for i in invoices if i.pp_price_review],
		"cash_outs": _cash_outs(closing.pos_opening_entry),
	}


# Business customers: a sale becomes an invoice with the client's name, address and ICE (spec 5.5).


@frappe.whitelist()
def search_customers(query: str = "") -> list[dict]:
	require_app_role(*SELLERS)
	query = (query or "").strip()
	filters = {"disabled": 0, "customer_type": "Company"}
	or_filters = None
	if query:
		like = f"%{query}%"
		or_filters = [["customer_name", "like", like], ["pp_ice", "like", like], ["name", "like", like]]
	return frappe.get_list(
		"Customer",
		filters=filters,
		or_filters=or_filters,
		fields=["name", "customer_name", "pp_ice"],
		order_by="customer_name asc",
		limit_page_length=20,
	)


@frappe.whitelist(methods=["POST"])
def create_business_customer(customer_name: str, ice: str, address_line1: str = "", city: str = "") -> dict:
	"""A company buying at the counter: ICE is required on its invoice (CGI art. 145)."""
	require_app_role(*SELLERS)
	from parapilot.validations.legal_ids import is_valid_ice, normalize_ice

	ice = normalize_ice(ice)
	if not customer_name.strip() or not is_valid_ice(ice):
		frappe.throw(_("A business customer needs a name and a 15-digit ICE."))
	existing = frappe.db.get_value("Customer", {"pp_ice": ice}, ["name", "customer_name", "pp_ice"], as_dict=True)
	if existing:
		return existing
	customer = frappe.get_doc(
		{
			"doctype": "Customer",
			"customer_name": customer_name.strip(),
			"customer_type": "Company",
			"pp_ice": ice,
			"customer_group": frappe.db.get_single_value("Selling Settings", "customer_group")
			or frappe.db.get_value("Customer Group", {"is_group": 0}),
			"territory": frappe.db.get_single_value("Selling Settings", "territory")
			or frappe.db.get_value("Territory", {"is_group": 0}),
		}
	).insert()
	if address_line1.strip():
		address = frappe.get_doc(
			{
				"doctype": "Address",
				"address_title": customer.customer_name,
				"address_type": "Billing",
				"address_line1": address_line1.strip(),
				"city": city.strip() or "-",
				"country": "Morocco",
				"is_primary_address": 1,
				"links": [{"link_doctype": "Customer", "link_name": customer.name}],
			}
		).insert()
		customer.db_set("customer_primary_address", address.name)
	return {"name": customer.name, "customer_name": customer.customer_name, "pp_ice": customer.pp_ice}


# Cash taken out of the drawer during the day, with a reason (spec 5.8).


def _cash_outs(opening_name: str) -> list[dict]:
	rows = frappe.get_all(
		"Journal Entry",
		filters={"pp_pos_opening_entry": opening_name, "docstatus": 1},
		fields=["name", "total_debit", "user_remark", "owner", "creation"],
		order_by="creation asc",
	)
	return [
		{
			"name": r.name,
			"amount": flt(r.total_debit, 2),
			"reason": r.user_remark,
			"by": frappe.utils.get_fullname(r.owner),
			"at": str(r.creation),
		}
		for r in rows
	]


@frappe.whitelist(methods=["POST"])
def record_cash_out(amount: float, reason: str) -> dict:
	require_app_role(*SELLERS)
	from parapilot.setup.defaults import ensure_petty_cash_account

	amount = flt(amount, 2)
	reason = (reason or "").strip()
	if amount <= 0 or not reason:
		frappe.throw(_("Enter an amount and a reason."))
	opening = _open_entry()
	if not opening:
		frappe.throw(_("Open a till first."), TillClosedError)
	cash_mode = next(
		(m["mode_of_payment"] for m in _payment_modes(opening.pos_profile) if m["type"] == "Cash"), None
	)
	cash_account = frappe.db.get_value(
		"Mode of Payment Account", {"parent": cash_mode, "company": opening.company}, "default_account"
	)
	company = frappe.get_cached_doc("Company", opening.company)
	entry = frappe.get_doc(
		{
			"doctype": "Journal Entry",
			"voucher_type": "Cash Entry",
			"company": opening.company,
			"posting_date": today(),
			"user_remark": reason,
			"pp_pos_opening_entry": opening.name,
			"accounts": [
				{
					"account": ensure_petty_cash_account(opening.company),
					"debit_in_account_currency": amount,
					"cost_center": company.cost_center,
				},
				{"account": cash_account, "credit_in_account_currency": amount},
			],
		}
	)
	# Cashiers have no general access to journal entries; this one is fixed to the till's cash.
	entry.flags.ignore_permissions = True
	entry.insert()
	entry.submit()
	return {"name": entry.name, "cash_outs": _cash_outs(opening.name)}
