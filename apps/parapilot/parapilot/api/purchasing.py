"""Purchasing (spec 5.3): suppliers, purchase orders, receiving, supplier invoices and payments.

Paper document -> ERPNext document:
  bon de commande -> Purchase Order       (nothing moves)
  bon de livraison -> Purchase Receipt    (stock goes up, nothing owed yet)
  facture -> Purchase Invoice             (amount owed and VAT recorded)
  paiement -> Payment Entry               (debt settled; purchase VAT becomes deductible)
Prices are entered VAT-included (TTC), like everywhere in ParaPilot.
"""

import json

import frappe
from frappe import _
from frappe.utils import add_months, cint, flt, get_first_day, get_last_day, getdate, today

from parapilot.api.catalog import _item_vat
from parapilot.utils import can_see_costs, get_app_roles, get_settings, get_template_rate, require_app_role

PRICE_TOLERANCE = 0.01  # invoice lines more than 1 % away from the delivery note are highlighted
# Who may correct or cancel a delivery note once recorded.
RECEIPT_CORRECTORS = ("owner", "manager")
SHORT_EXPIRY_MONTHS = 6


def _data(value) -> frappe._dict:
	return frappe._dict(json.loads(value) if isinstance(value, str) else value)


def _lines(rows) -> list[frappe._dict]:
	return [frappe._dict(r) for r in rows or []]


def _vat_rates(item_codes: list[str]) -> dict[str, float | None]:
	if not item_codes:
		return {}
	groups = dict(frappe.get_all("Item", filters={"name": ["in", item_codes]}, fields=["name", "item_group"], as_list=True))
	vat = _item_vat(list(groups), groups, get_settings().company)
	return {code: vat[code]["rate"] for code in groups}


def _buying_price_ttc(item_code: str) -> float | None:
	"""Last price paid, TTC: the buying price list first, else ERPNext's last purchase rate (HT) + VAT."""
	settings = get_settings()
	price = frappe.db.get_value(
		"Item Price", {"item_code": item_code, "price_list": settings.buying_price_list, "supplier": ["is", "not set"]}, "price_list_rate"
	)
	if price:
		return flt(price, 2)
	last = frappe.db.get_value("Item", item_code, "last_purchase_rate")
	if not last:
		return None
	rate = _vat_rates([item_code]).get(item_code) or 0
	return flt(last * (1 + rate / 100), 2)


def _remember_buying_price(item_code: str, rate: float):
	settings = get_settings()
	name = frappe.db.get_value(
		"Item Price", {"item_code": item_code, "price_list": settings.buying_price_list, "supplier": ["is", "not set"]}
	)
	if name:
		if flt(frappe.db.get_value("Item Price", name, "price_list_rate"), 2) != flt(rate, 2):
			frappe.db.set_value("Item Price", name, "price_list_rate", rate)
	else:
		frappe.get_doc(
			{"doctype": "Item Price", "item_code": item_code, "price_list": settings.buying_price_list, "price_list_rate": rate}
		).insert(ignore_permissions=True)


def _totals(doc) -> dict:
	from parapilot.api.pos import _vat_by_rate

	return {
		"ht": flt(doc.net_total, 2),
		"vat": flt(doc.total_taxes_and_charges, 2),
		"ttc": flt(doc.grand_total, 2),
		"vat_by_rate": _vat_by_rate([doc]),
	}


def _new_buying_doc(doctype: str, supplier: str):
	settings = get_settings()
	doc = frappe.new_doc(doctype)
	doc.update(
		{
			"company": settings.company,
			"supplier": supplier,
			"buying_price_list": settings.buying_price_list,
			"taxes_and_charges": settings.purchase_taxes_template,
			"disable_rounded_total": 1,
		}
	)
	return doc


def _apply_ttc_rates(doc, rates: list[float | None]):
	"""Our TTC price on each line: set after ERPNext filled the line from the price list."""
	for row, rate in zip(doc.items, rates):
		if rate is None:
			continue
		row.price_list_rate = row.rate = flt(rate, 2)
		row.discount_percentage = 0
		row.discount_amount = 0


# Suppliers -------------------------------------------------------------------------------------------

SUPPLIER_FIELDS = [
	"name",
	"supplier_name",
	"pp_ice",
	"pp_if",
	"pp_min_order_amount",
	"pp_lead_time_days",
	"pp_free_unit_terms",
	"disabled",
]


@frappe.whitelist()
def list_suppliers(search: str | None = None) -> list[dict]:
	frappe.has_permission("Supplier", "read", throw=True)
	filters: dict = {"disabled": 0}
	or_filters = None
	if search:
		like = f"%{search.strip()}%"
		or_filters = [["supplier_name", "like", like], ["pp_ice", "like", like]]
	suppliers = frappe.get_list(
		"Supplier", filters=filters, or_filters=or_filters, fields=SUPPLIER_FIELDS, order_by="supplier_name asc", limit_page_length=500
	)
	if suppliers and frappe.has_permission("Purchase Invoice", "read"):
		owed: dict[str, float] = {}
		for r in frappe.get_all(
			"Purchase Invoice",
			filters={"docstatus": 1, "outstanding_amount": [">", 0], "supplier": ["in", [s.name for s in suppliers]]},
			fields=["supplier", "outstanding_amount"],
		):
			owed[r.supplier] = owed.get(r.supplier, 0) + flt(r.outstanding_amount)
		for s in suppliers:
			s["outstanding"] = flt(owed.get(s.name, 0), 2)
	return suppliers


@frappe.whitelist()
def get_supplier(name: str) -> dict:
	frappe.has_permission("Supplier", "read", doc=name, throw=True)
	return frappe.db.get_value("Supplier", name, SUPPLIER_FIELDS, as_dict=True)


@frappe.whitelist(methods=["POST"])
def save_supplier(supplier: str | dict) -> dict:
	data = _data(supplier)
	if data.name:
		doc = frappe.get_doc("Supplier", data.name)
	else:
		doc = frappe.new_doc("Supplier")
		doc.supplier_group = frappe.db.get_single_value("Buying Settings", "supplier_group") or frappe.db.get_value(
			"Supplier Group", {"is_group": 0}
		)
		doc.country = "Morocco"
	for field in SUPPLIER_FIELDS[1:]:
		if field in data:
			doc.set(field, data[field])
	doc.save()
	return get_supplier(doc.name)


# Purchase orders -------------------------------------------------------------------------------------


@frappe.whitelist()
def list_purchase_orders(status: str | None = None, supplier: str | None = None) -> list[dict]:
	frappe.has_permission("Purchase Order", "read", throw=True)
	filters: dict = {"docstatus": ["<", 2]}
	if supplier:
		filters["supplier"] = supplier
	if status == "draft":
		filters["docstatus"] = 0
	elif status == "to_receive":
		filters.update({"docstatus": 1, "per_received": ["<", 100], "status": ["not in", ["Closed", "On Hold"]]})
	elif status == "received":
		filters.update({"docstatus": 1, "per_received": [">=", 100]})
	return frappe.get_list(
		"Purchase Order",
		filters=filters,
		fields=["name", "supplier", "supplier_name", "transaction_date", "schedule_date", "grand_total", "status", "per_received", "per_billed", "docstatus"],
		order_by="creation desc",
		limit_page_length=200,
	)


@frappe.whitelist()
def get_purchase_order(name: str) -> dict:
	doc = frappe.get_doc("Purchase Order", name)
	doc.check_permission("read")
	vat = _vat_rates([i.item_code for i in doc.items])
	return {
		"name": doc.name,
		"supplier": doc.supplier,
		"supplier_name": doc.supplier_name,
		"transaction_date": str(doc.transaction_date),
		"schedule_date": str(doc.schedule_date) if doc.schedule_date else None,
		"status": doc.status,
		"docstatus": doc.docstatus,
		"per_received": doc.per_received,
		"lines": [
			{
				"name": i.name,
				"item_code": i.item_code,
				"item_name": i.item_name,
				"qty": i.qty,
				"received_qty": i.received_qty,
				"rate": i.rate,
				"amount": i.amount,
				"vat_rate": vat.get(i.item_code),
			}
			for i in doc.items
		],
		"totals": _totals(doc),
		"can_submit": doc.docstatus == 0 and bool({"owner", "manager"} & set(get_app_roles())),
	}


@frappe.whitelist()
def suggest_order_lines(supplier: str) -> list[dict]:
	"""Products whose usual supplier this is, with stock and the quantity to order when under minimum."""
	frappe.has_permission("Purchase Order", "create", throw=True)
	settings = get_settings()
	codes = frappe.get_all(
		"Item Default",
		filters={"parenttype": "Item", "company": settings.company, "default_supplier": supplier},
		pluck="parent",
	)
	if not codes:
		return []
	items = frappe.get_all(
		"Item", filters={"name": ["in", codes], "disabled": 0}, fields=["name", "item_name", "pp_min_stock"], order_by="item_name asc"
	)
	sellable = [w for w in (settings.shop_floor_warehouse, settings.back_store_warehouse) if w]
	stock: dict[str, float] = {}
	for b in frappe.get_all("Bin", filters={"item_code": ["in", codes], "warehouse": ["in", sellable]}, fields=["item_code", "actual_qty", "ordered_qty"]):
		stock[b.item_code] = stock.get(b.item_code, 0) + flt(b.actual_qty) + flt(b.ordered_qty)
	vat = _vat_rates(codes)
	result = []
	for i in items:
		available = stock.get(i.name, 0)
		minimum = flt(i.pp_min_stock)
		result.append(
			{
				"item_code": i.name,
				"item_name": i.item_name,
				"stock": available,
				"min_stock": minimum,
				"suggested_qty": max(minimum * 2 - available, 0) if minimum and available < minimum else 0,
				"rate": _buying_price_ttc(i.name),
				"vat_rate": vat.get(i.name),
			}
		)
	return result


@frappe.whitelist(methods=["POST"])
def save_purchase_order(order: str | dict) -> dict:
	"""Saved as a draft: a stock clerk prepares it, an owner or manager submits it."""
	data = _data(order)
	lines = [l for l in _lines(data.lines) if flt(l.qty) > 0]
	if not data.supplier or not lines:
		frappe.throw(_("Choose a supplier and at least one product."))
	if data.name:
		doc = frappe.get_doc("Purchase Order", data.name)
		if doc.docstatus != 0:
			frappe.throw(_("This order is already submitted."))
		doc.supplier = data.supplier
		doc.set("items", [])
	else:
		doc = _new_buying_doc("Purchase Order", data.supplier)
	settings = get_settings()
	lead = cint(frappe.db.get_value("Supplier", data.supplier, "pp_lead_time_days")) or 3
	doc.transaction_date = today()
	doc.schedule_date = data.schedule_date or frappe.utils.add_days(today(), lead)
	doc.set_warehouse = settings.shop_floor_warehouse
	for line in lines:
		doc.append("items", {"item_code": line.item_code, "qty": flt(line.qty), "schedule_date": doc.schedule_date, "warehouse": settings.shop_floor_warehouse})
	doc.set_missing_values()
	_apply_ttc_rates(doc, [l.get("rate") for l in lines])
	doc.save()
	return get_purchase_order(doc.name)


@frappe.whitelist(methods=["POST"])
def submit_purchase_order(name: str) -> dict:
	require_app_role("owner", "manager")
	doc = frappe.get_doc("Purchase Order", name)
	doc.submit()
	return get_purchase_order(doc.name)


# Receiving (bon de livraison -> Purchase Receipt) ------------------------------------------------------


@frappe.whitelist()
def list_receipts(supplier: str | None = None) -> list[dict]:
	frappe.has_permission("Purchase Receipt", "read", throw=True)
	filters: dict = {"docstatus": ["in", [1, 2]], "is_return": 0}
	if supplier:
		filters["supplier"] = supplier
	fields = [
		"name",
		"supplier",
		"supplier_name",
		"supplier_delivery_note",
		"posting_date",
		"status",
		"docstatus",
		"per_billed",
		"pp_damage_return",
		"pp_corrects",
		"taxes_and_charges",
		"total_taxes_and_charges",
	]
	if can_see_costs():
		fields.append("grand_total")
	rows = frappe.get_list("Purchase Receipt", filters=filters, fields=fields, order_by="posting_date desc, creation desc", limit_page_length=200)
	for r in rows:
		r["vat_included"] = receipt_has_vat(r.pop("taxes_and_charges"), r.pop("total_taxes_and_charges"))
	return rows


@frappe.whitelist()
def get_receipt_draft(purchase_order: str | None = None, correct: str | None = None) -> dict:
	"""Lines still to receive on an order, priced as ordered; the lines of a delivery note to correct;
	or an empty receipt."""
	settings = get_settings()
	result = {
		"warehouses": [
			{"name": settings.shop_floor_warehouse, "role": "shop_floor"},
			{"name": settings.back_store_warehouse, "role": "back_store"},
		],
		"lines": [],
		"supplier": None,
		"purchase_order": None,
		"corrects": None,
	}
	if correct:
		require_app_role(*RECEIPT_CORRECTORS)
		pr = frappe.get_doc("Purchase Receipt", correct)
		_check_correctable(pr)
		vat = _vat_rates([i.item_code for i in pr.items])
		result.update(
			{
				"supplier": pr.supplier,
				"supplier_name": pr.supplier_name,
				"supplier_delivery_note": pr.supplier_delivery_note,
				"warehouse": pr.set_warehouse or pr.items[0].warehouse,
				"purchase_order": next((i.purchase_order for i in pr.items if i.purchase_order), None),
				"corrects": pr.name,
				"lines": [
					{**line, "vat_rate": vat.get(line["item_code"]), "has_batch_no": frappe.get_cached_value("Item", line["item_code"], "has_batch_no")}
					for line in _editor_lines(pr)
				],
			}
		)
		return result
	if purchase_order:
		po = frappe.get_doc("Purchase Order", purchase_order)
		po.check_permission("read")
		vat = _vat_rates([i.item_code for i in po.items])
		result.update({"supplier": po.supplier, "supplier_name": po.supplier_name, "purchase_order": po.name})
		for i in po.items:
			remaining = flt(i.qty) - flt(i.received_qty)
			if remaining <= 0:
				continue
			result["lines"].append(
				{
					"item_code": i.item_code,
					"item_name": i.item_name,
					"purchase_order_item": i.name,
					"ordered_qty": remaining,
					"qty": remaining,
					"rate": i.rate,
					"vat_rate": vat.get(i.item_code),
					"has_batch_no": frappe.get_cached_value("Item", i.item_code, "has_batch_no"),
				}
			)
	return result


@frappe.whitelist()
def find_receiving_item(code: str) -> dict:
	"""A scanned barcode or typed code, with what the receiving screen needs."""
	frappe.has_permission("Item", "read", throw=True)
	item_code = frappe.db.get_value("Item Barcode", {"barcode": code.strip(), "parenttype": "Item"}, "parent") or (
		code.strip() if frappe.db.exists("Item", code.strip()) else None
	)
	if not item_code:
		frappe.throw(_("Unknown barcode: {0}").format(code), frappe.DoesNotExistError)
	item = frappe.db.get_value("Item", item_code, ["item_name", "has_batch_no", "is_stock_item", "disabled"], as_dict=True)
	return {
		"item_code": item_code,
		"item_name": item.item_name,
		"has_batch_no": item.has_batch_no,
		"rate": _buying_price_ttc(item_code),
		"vat_rate": _vat_rates([item_code]).get(item_code),
	}


def _batch_for(item_code: str, lot: str, expiry_date: str | None, supplier: str) -> str:
	"""The supplier's lot number as the batch; prefixed with the item when another item uses that number."""
	lot = lot.strip()
	if not lot:
		frappe.throw(_("Enter the lot number for {0}.").format(frappe.get_cached_value("Item", item_code, "item_name")))
	for name in (lot, f"{item_code}-{lot}"):
		existing = frappe.db.get_value("Batch", name, ["item", "expiry_date"], as_dict=True)
		if existing and existing.item == item_code:
			if expiry_date and existing.expiry_date and getdate(existing.expiry_date) != getdate(expiry_date):
				frappe.throw(_("Lot {0} is already recorded with another expiry date.").format(lot))
			return name
		if not existing:
			# A lot seen before may have expired since (a delivery corrected later); a new one may not.
			if expiry_date and getdate(expiry_date) < getdate(today()):
				frappe.throw(_("Lot {0} is already expired ({1}).").format(lot, frappe.format(expiry_date, "Date")))
			return (
				frappe.get_doc(
					{
						"doctype": "Batch",
						"batch_id": name,
						"item": item_code,
						"expiry_date": expiry_date,
						"supplier": supplier,
						"description": lot,
					}
				)
				.insert(ignore_permissions=True)
				.name
			)
	frappe.throw(_("Lot {0} cannot be used for this product.").format(lot))


@frappe.whitelist(methods=["POST"])
def submit_receipt(receipt: str | dict) -> dict:
	"""Record what arrived. Stock goes up at the delivery note price; nothing is owed until the invoice.
	Free units are a separate zero-price line in the same batch, so the batch's cost per unit drops.
	Damaged units go to Quarantine and a draft return to the supplier is prepared."""
	data = _data(receipt)
	settings = get_settings()
	lines = [l for l in _lines(data.lines) if flt(l.qty) + flt(l.free_qty) + flt(l.damaged_qty) > 0]
	if not data.supplier or not lines:
		frappe.throw(_("Choose a supplier and scan at least one product."))
	warehouse = data.warehouse or settings.shop_floor_warehouse

	original = None
	if data.corrects:
		require_app_role(*RECEIPT_CORRECTORS)
		original = frappe.get_doc("Purchase Receipt", data.corrects)
		_check_correctable(original)
		if original.supplier != data.supplier:
			frappe.throw(_("A correction keeps the supplier. Cancel the delivery note and record a new one instead."))

	pr = _new_buying_doc("Purchase Receipt", data.supplier)
	pr.update(
		{
			"supplier_delivery_note": (data.supplier_delivery_note or "").strip() or None,
			"set_warehouse": warehouse,
			"rejected_warehouse": settings.quarantine_warehouse,
		}
	)
	if original:
		# Same date and time as the delivery it replaces, so what was sold since still came from it.
		pr.update(
			{
				"set_posting_time": 1,
				"posting_date": original.posting_date,
				"posting_time": original.posting_time,
			}
		)
	rates: list[float | None] = []
	for line in lines:
		has_batch = cint(frappe.get_cached_value("Item", line.item_code, "has_batch_no"))
		batch = _batch_for(line.item_code, line.lot or "", line.expiry_date, data.supplier) if has_batch else None
		common = {"item_code": line.item_code, "warehouse": warehouse, "batch_no": batch, "use_serial_batch_fields": 1}
		paid = flt(line.qty)
		damaged = flt(line.damaged_qty)
		if paid + damaged > 0:
			pr.append(
				"items",
				{
					**common,
					"qty": paid,
					"received_qty": paid + damaged,
					"rejected_qty": damaged,
					"rejected_warehouse": settings.quarantine_warehouse if damaged else None,
					"purchase_order": data.purchase_order if line.purchase_order_item else None,
					"purchase_order_item": line.purchase_order_item,
				},
			)
			rates.append(flt(line.rate, 2))
		if flt(line.free_qty) > 0:
			pr.append(
				"items",
				{**common, "qty": flt(line.free_qty), "received_qty": flt(line.free_qty), "is_free_item": 1, "allow_zero_valuation_rate": 1},
			)
			rates.append(0)
	pr.set_missing_values()
	_apply_ttc_rates(pr, rates)
	ordered = original and any(i.purchase_order_item for i in original.items)
	if ordered:
		# Received quantities on the order would otherwise count both delivery notes for a moment.
		_cancel_receipt(original)
	pr.insert()
	pr.submit()
	if original and not ordered:
		_cancel_receipt(original)
	if original:
		# Linked after the cancellation: ERPNext refuses to cancel a document another one points to.
		pr.db_set("pp_corrects", original.name)
		_repost_soon()

	for line in lines:
		if flt(line.rate) > 0:
			_remember_buying_price(line.item_code, flt(line.rate, 2))

	if any(flt(l.damaged_qty) > 0 for l in lines):
		from erpnext.controllers.sales_and_purchase_return import make_return_doc

		ret = make_return_doc("Purchase Receipt", pr.name, return_against_rejected_qty=True)
		ret.insert()
		pr.db_set("pp_damage_return", ret.name)

	warnings = [
		{"code": "short_expiry", "item_name": frappe.get_cached_value("Item", l.item_code, "item_name"), "expiry_date": l.expiry_date}
		for l in lines
		if l.expiry_date and getdate(l.expiry_date) < getdate(add_months(today(), SHORT_EXPIRY_MONTHS))
	]
	return {"name": pr.name, "damage_return": pr.get("pp_damage_return"), "warnings": warnings}


def receipt_has_vat(taxes_and_charges: str | None, vat: float) -> bool:
	"""False for a delivery note typed in ERPNext without VAT (no template, or an old template that
	charged none): its stock is valued VAT included. Exempt goods on ParaPilot's template count as with VAT."""
	return bool(flt(vat)) or taxes_and_charges == get_settings().purchase_taxes_template


def _receipt_invoices(name: str) -> list[str]:
	return frappe.db.sql_list(
		"""select distinct pi.name from `tabPurchase Invoice Item` pii
		join `tabPurchase Invoice` pi on pi.name = pii.parent
		where pii.purchase_receipt = %s and pi.docstatus < 2""",
		name,
	)


def _correction_blocked(pr) -> str | None:
	"""Why a delivery note can no longer be corrected or cancelled, as a code the screen explains."""
	if pr.docstatus == 2:
		return "cancelled"
	if pr.docstatus == 0 or pr.is_return:
		return "not_a_delivery"
	if _receipt_invoices(pr.name):
		return "invoiced"
	if frappe.db.exists("Purchase Receipt", {"return_against": pr.name, "is_return": 1, "docstatus": 1}):
		return "returned"
	return None


def _check_correctable(pr):
	pr.check_permission("cancel")
	reason = _correction_blocked(pr)
	messages = {
		"cancelled": _("This delivery note is already cancelled."),
		"not_a_delivery": _("Only a recorded delivery note can be corrected."),
		"invoiced": _("A supplier invoice includes this delivery note. Correct the invoice or record a credit note instead."),
		"returned": _("Goods from this delivery note were sent back to the supplier. Cancel that return first."),
	}
	if reason:
		frappe.throw(messages[reason])


def _receipt_batch(row) -> str | None:
	if row.batch_no:
		return row.batch_no
	if row.serial_and_batch_bundle:
		return frappe.db.get_value("Serial and Batch Entry", {"parent": row.serial_and_batch_bundle}, "batch_no")
	return None


def _editor_lines(pr) -> list[dict]:
	"""The delivery note as the receiving screen enters it: one line per product and lot, with paid,
	free and damaged quantities."""
	lines: dict[tuple, dict] = {}
	for row in pr.items:
		batch = _receipt_batch(row)
		lot = batch and frappe.db.get_value("Batch", batch, ["description", "batch_id", "expiry_date"], as_dict=True)
		line = lines.setdefault(
			(row.item_code, batch, row.purchase_order_item if not row.is_free_item else None),
			{
				"item_code": row.item_code,
				"item_name": row.item_name,
				"purchase_order_item": None,
				"qty": 0,
				"free_qty": 0,
				"damaged_qty": 0,
				"lot": (lot.description or lot.batch_id) if lot else "",
				"expiry_date": str(lot.expiry_date) if lot and lot.expiry_date else "",
				"rate": 0,
			},
		)
		if row.is_free_item or not flt(row.rate):
			line["free_qty"] += flt(row.qty)
		else:
			line["qty"] += flt(row.qty)
			line["damaged_qty"] += flt(row.rejected_qty)
			line["rate"] = flt(row.rate, 2)
			line["purchase_order_item"] = row.purchase_order_item
	return list(lines.values())


def _drop_draft_damage_return(pr):
	if pr.pp_damage_return and frappe.db.get_value("Purchase Receipt", pr.pp_damage_return, "docstatus") == 0:
		frappe.delete_doc("Purchase Receipt", pr.pp_damage_return, ignore_permissions=True)


def _cancel_receipt(pr):
	from erpnext.stock.doctype.serial_and_batch_bundle.serial_and_batch_bundle import BatchNegativeStockError
	from erpnext.stock.stock_ledger import NegativeStockError

	_drop_draft_damage_return(pr)
	try:
		pr.cancel()
	except (NegativeStockError, BatchNegativeStockError):
		frappe.throw(
			_("Part of these goods was already sold or moved, so the delivery note cannot be cancelled. Correct it with at least the quantities sold, or record a supplier return.")
		)


def _repost_soon():
	"""Recompute the cost of what was sold since the delivery now, rather than at the next hourly run.
	A bulk run reposts once at the end instead: two reposts at once break each other."""
	if frappe.flags.pp_repost_at_end:
		return
	frappe.enqueue(
		"erpnext.stock.doctype.repost_item_valuation.repost_item_valuation.repost_entries",
		queue="long",
		enqueue_after_commit=True,
	)


@frappe.whitelist()
def get_receipt(name: str) -> dict:
	"""A delivery note: what arrived (lots, expiry, free and damaged units), its VAT and totals, the invoices
	that cover it, and whether it can still be corrected."""
	pr = frappe.get_doc("Purchase Receipt", name)
	pr.check_permission("read")
	show_costs = can_see_costs()
	blocked = _correction_blocked(pr)
	may_correct = bool({*RECEIPT_CORRECTORS} & set(get_app_roles()))
	lines = []
	for line in _editor_lines(pr):
		if not show_costs:
			line.pop("rate")
		lines.append(line)
	return {
		"name": pr.name,
		"supplier": pr.supplier,
		"supplier_name": pr.supplier_name,
		"supplier_delivery_note": pr.supplier_delivery_note,
		"posting_date": str(pr.posting_date),
		"posting_time": str(pr.posting_time).split(".")[0],
		"docstatus": pr.docstatus,
		"status": pr.status,
		"received_by": frappe.utils.get_fullname(pr.owner),
		"warehouse": pr.set_warehouse or (pr.items[0].warehouse if pr.items else None),
		"vat_included": receipt_has_vat(pr.taxes_and_charges, pr.total_taxes_and_charges),
		"lines": lines,
		"totals": _totals(pr) if show_costs else None,
		"invoices": _receipt_invoices(pr.name),
		"damage_return": pr.pp_damage_return,
		"corrects": pr.pp_corrects,
		"corrected_by": frappe.db.get_value("Purchase Receipt", {"pp_corrects": pr.name, "docstatus": 1}, "name"),
		"blocked": blocked,
		"can_correct": may_correct and not blocked,
	}


@frappe.whitelist(methods=["POST"])
def cancel_receipt(name: str, reason: str) -> dict:
	"""Cancel a delivery note recorded by mistake: its stock leaves and its accounting entries are reversed.
	It stays in the list as cancelled, with the reason."""
	require_app_role(*RECEIPT_CORRECTORS)
	if not (reason or "").strip():
		frappe.throw(_("Say why the delivery note is cancelled."))
	pr = frappe.get_doc("Purchase Receipt", name)
	_check_correctable(pr)
	_cancel_receipt(pr)
	pr.add_comment("Comment", _("Cancelled: {0}").format(reason.strip()))
	_repost_soon()
	return get_receipt(name)


# Supplier invoices -------------------------------------------------------------------------------------


@frappe.whitelist()
def list_invoices(status: str | None = None, supplier: str | None = None) -> list[dict]:
	frappe.has_permission("Purchase Invoice", "read", throw=True)
	filters: dict = {"docstatus": ["<", 2], "is_return": 0}
	if supplier:
		filters["supplier"] = supplier
	if status == "draft":
		filters["docstatus"] = 0
	elif status == "unpaid":
		filters.update({"docstatus": 1, "outstanding_amount": [">", 0]})
	elif status == "paid":
		filters.update({"docstatus": 1, "outstanding_amount": 0})
	return frappe.get_list(
		"Purchase Invoice",
		filters=filters,
		fields=[
			"name",
			"supplier",
			"supplier_name",
			"bill_no",
			"bill_date",
			"posting_date",
			"due_date",
			"grand_total",
			"outstanding_amount",
			"status",
			"docstatus",
			"pp_company_ice_on_invoice",
		],
		order_by="posting_date desc, creation desc",
		limit_page_length=200,
	)


@frappe.whitelist()
def open_receipts(supplier: str) -> list[dict]:
	"""Delivery notes of a supplier not invoiced yet: one invoice often covers a month of deliveries."""
	frappe.has_permission("Purchase Receipt", "read", throw=True)
	return frappe.get_all(
		"Purchase Receipt",
		filters={"supplier": supplier, "docstatus": 1, "is_return": 0, "per_billed": ["<", 100], "status": ["!=", "Closed"]},
		fields=["name", "supplier_delivery_note", "posting_date", "grand_total", "per_billed"],
		order_by="posting_date asc",
	)


def _invoice_from_receipts(supplier: str, receipts: list[str]):
	from erpnext.controllers.accounts_controller import get_taxes_and_charges
	from erpnext.stock.doctype.purchase_receipt.purchase_receipt import make_purchase_invoice

	invoice = None
	for name in receipts:
		if frappe.db.get_value("Purchase Receipt", name, "supplier") != supplier:
			frappe.throw(_("Delivery note {0} is from another supplier.").format(name))
		invoice = make_purchase_invoice(name, target_doc=invoice)
	if invoice:
		# Prices are TTC: the invoice always carries the VAT-included template, even for a delivery note
		# entered in ERPNext without one. Its HT price then revalues the delivered stock.
		template = get_settings().purchase_taxes_template
		invoice.taxes_and_charges = template
		invoice.set("taxes", get_taxes_and_charges("Purchase Taxes and Charges Template", template))
	return invoice


def _receipt_rates(invoice) -> dict[str, float]:
	details = [i.pr_detail for i in invoice.items if i.pr_detail]
	if not details:
		return {}
	return dict(frappe.get_all("Purchase Receipt Item", filters={"name": ["in", details]}, fields=["name", "rate"], as_list=True))


def _price_warnings(invoice) -> list[dict]:
	expected = _receipt_rates(invoice)
	warnings = []
	for row in invoice.items:
		reference = flt(expected.get(row.pr_detail)) if row.pr_detail else 0
		if reference and abs(flt(row.rate) - reference) / reference > PRICE_TOLERANCE:
			warnings.append(
				{"code": "price_differs", "item_name": row.item_name, "receipt_rate": reference, "invoice_rate": flt(row.rate), "row": row.idx}
			)
	return warnings


@frappe.whitelist()
def preview_invoice(supplier: str, receipts: str | list) -> dict:
	"""Lines an invoice for these delivery notes would have, at the delivery note prices."""
	receipts = json.loads(receipts) if isinstance(receipts, str) else receipts
	frappe.has_permission("Purchase Invoice", "create", throw=True)
	invoice = _invoice_from_receipts(supplier, receipts)
	if not invoice:
		return {"lines": []}
	vat = _vat_rates([i.item_code for i in invoice.items])
	return {
		"lines": [
			{
				"item_code": i.item_code,
				"item_name": i.item_name,
				"qty": i.qty,
				"rate": i.rate,
				"receipt_rate": i.rate,
				"purchase_receipt": i.purchase_receipt,
				"pr_detail": i.pr_detail,
				"is_free_item": i.is_free_item,
				"vat_rate": vat.get(i.item_code),
			}
			for i in invoice.items
		]
	}


@frappe.whitelist()
def overhead_items() -> list[dict]:
	frappe.has_permission("Purchase Invoice", "create", throw=True)
	items = frappe.get_all(
		"Item",
		filters={"item_group": ["descendants of (inclusive)", "Frais généraux"], "disabled": 0, "is_purchase_item": 1},
		fields=["name", "item_name"],
		order_by="item_name asc",
	)
	vat = _vat_rates([i.name for i in items])
	return [{"item_code": i.name, "item_name": i.item_name, "vat_rate": vat.get(i.name)} for i in items]


@frappe.whitelist(methods=["POST"])
def save_invoice(invoice: str | dict) -> dict:
	"""Draft supplier invoice from delivery notes (goods) or from overhead lines (electricity, internet…)."""
	data = _data(invoice)
	lines = _lines(data.lines)
	if not data.supplier:
		frappe.throw(_("Choose a supplier."))
	if not (data.bill_no or "").strip():
		frappe.throw(_("Enter the supplier's invoice number."))

	if data.name:
		# Editing a draft replaces it (drafts are not in the accounts yet).
		existing = frappe.get_doc("Purchase Invoice", data.name)
		if existing.docstatus != 0:
			frappe.throw(_("This invoice is already submitted."))
		frappe.delete_doc("Purchase Invoice", existing.name)

	receipts = data.receipts or []
	if receipts:
		pi = _invoice_from_receipts(data.supplier, receipts)
		by_detail = {l.pr_detail: l for l in lines if l.pr_detail}
		for row in pi.items:
			line = by_detail.get(row.pr_detail)
			if line:
				row.qty = min(flt(line.qty), flt(row.qty))
				row.price_list_rate = row.rate = flt(line.rate, 2)
		pi.set("items", [r for r in pi.items if flt(r.qty) > 0])
	else:
		pi = _new_buying_doc("Purchase Invoice", data.supplier)
		pi.update_stock = 0
		for line in lines:
			pi.append("items", {"item_code": line.item_code, "qty": flt(line.qty) or 1})
		pi.set_missing_values()
		_apply_ttc_rates(pi, [l.get("rate") for l in lines])

	pi.update(
		{
			"bill_no": data.bill_no.strip(),
			"bill_date": data.bill_date or today(),
			"posting_date": data.posting_date or today(),
			"set_posting_time": 1,
			"pp_company_ice_on_invoice": cint(data.pp_company_ice_on_invoice),
			"disable_rounded_total": 1,
		}
	)
	pi.insert()
	return get_invoice(pi.name)


@frappe.whitelist(methods=["POST"])
def submit_invoice(name: str) -> dict:
	require_app_role("owner", "manager", "accountant")
	doc = frappe.get_doc("Purchase Invoice", name)
	doc.submit()
	return get_invoice(doc.name)


def _payments(invoice: str) -> list[dict]:
	return frappe.db.sql(
		"""select pe.name, pe.posting_date, pe.mode_of_payment, ref.allocated_amount as amount, pe.reference_no
		from `tabPayment Entry Reference` ref join `tabPayment Entry` pe on pe.name = ref.parent
		where ref.reference_doctype = 'Purchase Invoice' and ref.reference_name = %s and pe.docstatus = 1
		order by pe.posting_date""",
		invoice,
		as_dict=True,
	)


@frappe.whitelist()
def get_invoice(name: str) -> dict:
	doc = frappe.get_doc("Purchase Invoice", name)
	doc.check_permission("read")
	vat = _vat_rates([i.item_code for i in doc.items])
	receipt_rates = _receipt_rates(doc)
	return {
		"name": doc.name,
		"supplier": doc.supplier,
		"supplier_name": doc.supplier_name,
		"bill_no": doc.bill_no,
		"bill_date": str(doc.bill_date) if doc.bill_date else None,
		"posting_date": str(doc.posting_date),
		"due_date": str(doc.due_date) if doc.due_date else None,
		"docstatus": doc.docstatus,
		"status": doc.status,
		"pp_company_ice_on_invoice": doc.pp_company_ice_on_invoice,
		"receipts": sorted({i.purchase_receipt for i in doc.items if i.purchase_receipt}),
		"lines": [
			{
				"row": i.name,
				"item_code": i.item_code,
				"item_name": i.item_name,
				"qty": i.qty,
				"rate": i.rate,
				"amount": i.amount,
				"receipt_rate": receipt_rates.get(i.pr_detail),
				"purchase_receipt": i.purchase_receipt,
				"pr_detail": i.pr_detail,
				"is_free_item": i.is_free_item,
				"vat_rate": vat.get(i.item_code),
			}
			for i in doc.items
		],
		"totals": _totals(doc),
		"outstanding": flt(doc.outstanding_amount, 2),
		"payments": _payments(doc.name) if doc.docstatus == 1 else [],
		"warnings": _price_warnings(doc),
		"can_submit": doc.docstatus == 0 and bool({"owner", "manager", "accountant"} & set(get_app_roles())),
		"can_pay": doc.docstatus == 1 and flt(doc.outstanding_amount) > 0 and bool(frappe.has_permission("Payment Entry", "create")),
	}


# Payments ---------------------------------------------------------------------------------------------


@frappe.whitelist()
def payment_modes() -> list[dict]:
	"""Ways to pay a supplier, with an account for the company."""
	company = get_settings().company
	modes = frappe.get_all("Mode of Payment", filters={"enabled": 1}, fields=["name", "type"])
	accounts = dict(
		frappe.get_all(
			"Mode of Payment Account", filters={"company": company, "default_account": ["is", "set"]}, fields=["parent", "default_account"], as_list=True
		)
	)
	return [{"mode_of_payment": m.name, "type": m.type} for m in modes if m.name in accounts and m.name != "Carte bancaire"]


def _cash_paid(supplier: str, start, end) -> float:
	return flt(
		frappe.db.sql(
			"""select coalesce(sum(pe.paid_amount), 0) from `tabPayment Entry` pe
			join `tabMode of Payment` mop on mop.name = pe.mode_of_payment
			where pe.docstatus = 1 and pe.payment_type = 'Pay' and pe.party_type = 'Supplier'
			and pe.party = %s and mop.type = 'Cash' and pe.posting_date between %s and %s""",
			(supplier, start, end),
		)[0][0]
	)


@frappe.whitelist()
def check_cash_limit(invoice: str, amount: float, posting_date: str | None = None) -> dict:
	"""Purchase VAT paid in cash is deductible up to 5,000 DH TTC a day and 50,000 DH a month per
	supplier. Returns the totals after this payment and the VAT that would no longer be deductible."""
	doc = frappe.get_doc("Purchase Invoice", invoice)
	doc.check_permission("read")
	settings = get_settings()
	day = getdate(posting_date or today())
	amount = flt(amount, 2)
	daily = _cash_paid(doc.supplier, day, day) + amount
	monthly = _cash_paid(doc.supplier, get_first_day(day), get_last_day(day)) + amount
	daily_limit = flt(settings.cash_deduction_daily_limit) or 5000
	monthly_limit = flt(settings.cash_deduction_monthly_limit) or 50000
	over = min(amount, max(daily - daily_limit, monthly - monthly_limit, 0))
	vat_share = flt(doc.total_taxes_and_charges) / flt(doc.grand_total) if flt(doc.grand_total) else 0
	return {
		"daily_total": flt(daily, 2),
		"monthly_total": flt(monthly, 2),
		"daily_limit": daily_limit,
		"monthly_limit": monthly_limit,
		"over_amount": flt(over, 2),
		"vat_at_risk": flt(over * vat_share, 2),
	}


@frappe.whitelist(methods=["POST"])
def pay_invoice(
	invoice: str, amount: float, mode_of_payment: str, posting_date: str | None = None, reference_no: str | None = None
) -> dict:
	from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

	doc = frappe.get_doc("Purchase Invoice", invoice)
	amount = flt(amount, 2)
	if amount <= 0 or amount > flt(doc.outstanding_amount) + 0.001:
		frappe.throw(_("The amount must be between 0 and {0}.").format(flt(doc.outstanding_amount, 2)))
	mode_type = frappe.get_cached_value("Mode of Payment", mode_of_payment, "type")
	if mode_type == "Bank" and not (reference_no or "").strip():
		frappe.throw(_("Enter the cheque or transfer reference."))
	account = frappe.db.get_value(
		"Mode of Payment Account", {"parent": mode_of_payment, "company": doc.company}, "default_account"
	)
	day = posting_date or today()
	pe = get_payment_entry("Purchase Invoice", doc.name, party_amount=amount)
	pe.update(
		{
			"mode_of_payment": mode_of_payment,
			"paid_from": account,
			"paid_amount": amount,
			"received_amount": amount,
			"posting_date": day,
			"reference_no": (reference_no or "").strip() or None,
			"reference_date": day if mode_type == "Bank" else None,
		}
	)
	pe.references[0].allocated_amount = amount
	pe.insert()
	pe.submit()
	result = get_invoice(doc.name)
	result["payment"] = pe.name
	return result
