"""Returns (spec 5.7): customer returns at the till, supplier returns and supplier credit notes.

A customer return is a return Sales Invoice made from the original sale: ERPNext reverses its VAT and
puts the batch back in stock (shop floor, or quarantine when the product cannot be resold).
"""

import json

import frappe
from frappe import _
from frappe.utils import cint, flt

from parapilot.api.pos import SELLERS, TillClosedError, _open_entry, get_receipt
from parapilot.utils import can_see_costs, get_app_roles, get_settings, require_app_role

PIN_ATTEMPTS = 5
PIN_WINDOW_SECONDS = 600


def _rows(value) -> list[dict]:
	return json.loads(value) if isinstance(value, str) else (value or [])


# Manager PIN -----------------------------------------------------------------------------------------


def store_pin(user: str, pin: str):
	"""Encrypt the PIN in __Auth and put Frappe's '*****' placeholder in the field: a later save of the
	User with an empty Password field would otherwise delete the stored PIN."""
	from frappe.utils.password import set_encrypted_password

	set_encrypted_password("User", user, pin, "pp_manager_pin")
	frappe.db.set_value("User", user, "pp_manager_pin", "*" * len(pin), update_modified=False)


@frappe.whitelist(methods=["POST"])
def set_my_pin(pin: str) -> dict:
	"""Owners and managers choose the PIN they type to approve a cashier's return."""
	require_app_role("owner", "manager")
	pin = (pin or "").strip()
	if not pin.isdigit() or not 4 <= len(pin) <= 6:
		frappe.throw(_("The PIN must be 4 to 6 digits."))
	store_pin(frappe.session.user, pin)
	return {"ok": True}


@frappe.whitelist()
def my_pin_status() -> dict:
	return {"has_pin": bool(_pin_of(frappe.session.user))}


def _pin_of(user: str) -> str | None:
	from frappe.utils.password import get_decrypted_password

	return get_decrypted_password("User", user, "pp_manager_pin", raise_exception=False)


def verify_manager_pin(pin: str | None) -> str:
	"""The manager whose PIN this is; a few wrong attempts lock the check for a while."""
	key = f"parapilot:pin-failures:{frappe.session.user}"
	failures = cint(frappe.cache.get_value(key))
	if failures >= PIN_ATTEMPTS:
		frappe.throw(_("Too many wrong PINs. Try again in a few minutes."), frappe.PermissionError)
	pin = (pin or "").strip()
	if pin:
		managers = frappe.get_all(
			"Has Role",
			filters={"role": ["in", ["ParaPilot Owner", "ParaPilot Manager"]], "parenttype": "User"},
			pluck="parent",
			distinct=True,
		)
		for user in managers:
			if frappe.db.get_value("User", user, "enabled") and _pin_of(user) == pin:
				frappe.cache.delete_value(key)
				return user
	frappe.cache.set_value(key, failures + 1, expires_in_sec=PIN_WINDOW_SECONDS)
	frappe.throw(_("Wrong manager PIN."), frappe.PermissionError)


def _needs_pin(amount: float) -> bool:
	"""Cashiers need a manager's PIN above the threshold in ParaPilot Settings; managers do not."""
	if {"owner", "manager"} & set(get_app_roles()):
		return False
	return flt(amount) > flt(get_settings().return_pin_threshold)


# Customer returns ------------------------------------------------------------------------------------


def _returned_qty(invoice: str) -> dict[str, float]:
	rows = frappe.db.sql(
		"""select item.sales_invoice_item, sum(-item.qty) from `tabSales Invoice Item` item
		join `tabSales Invoice` inv on inv.name = item.parent
		where inv.return_against = %s and inv.docstatus = 1 and inv.is_return = 1
		group by item.sales_invoice_item""",
		invoice,
	)
	return {row: flt(qty) for row, qty in rows if row}


@frappe.whitelist()
def find_sale(code: str) -> dict:
	"""The sale behind a receipt: scanned barcode (device sale ID) or invoice number."""
	require_app_role(*SELLERS)
	code = (code or "").strip()
	name = frappe.db.get_value("Sales Invoice", {"pp_client_uuid": code.upper()}, "name") or (
		code if frappe.db.exists("Sales Invoice", code) else None
	)
	if not name:
		frappe.throw(_("No sale found for {0}.").format(code), frappe.DoesNotExistError)
	inv = frappe.get_doc("Sales Invoice", name)
	inv.check_permission("read")
	if inv.docstatus != 1 or inv.is_return:
		frappe.throw(_("{0} cannot be returned.").format(name))
	returned = _returned_qty(inv.name)
	return {
		"name": inv.name,
		"client_id": inv.pp_client_uuid,
		"posting_date": str(inv.posting_date),
		"customer_name": inv.customer_name,
		"grand_total": inv.grand_total,
		"payments": [p.mode_of_payment for p in inv.payments if p.amount],
		"pin_threshold": flt(get_settings().return_pin_threshold),
		"needs_pin_role": not bool({"owner", "manager"} & set(get_app_roles())),
		"lines": [
			{
				"row": i.name,
				"item_code": i.item_code,
				"item_name": i.item_name,
				"qty": i.qty,
				"returnable": max(flt(i.qty) - returned.get(i.name, 0), 0),
				"rate": i.rate,
			}
			for i in inv.items
		],
	}


@frappe.whitelist(methods=["POST"])
def submit_return(invoice: str, lines: str | list, refund_mode: str, pin: str | None = None) -> dict:
	"""Return Sales Invoice for the chosen lines, refunded in cash or card from the open till."""
	require_app_role(*SELLERS)
	from erpnext.controllers.sales_and_purchase_return import make_return_doc

	lines = {l["row"]: l for l in _rows(lines) if flt(l.get("qty")) > 0}
	if not lines:
		frappe.throw(_("Choose what the customer brings back."))
	opening = _open_entry()
	if not opening:
		frappe.throw(_("Open a till before taking a return."), TillClosedError)

	settings = get_settings()
	ret = make_return_doc("Sales Invoice", invoice)
	returnable = {row["row"]: row["returnable"] for row in find_sale(invoice)["lines"]}
	kept = []
	for item in ret.items:
		line = lines.get(item.sales_invoice_item)
		if not line:
			continue
		qty = flt(line["qty"])
		if qty > returnable.get(item.sales_invoice_item, 0) + 0.0001:
			frappe.throw(_("{0}: more than was sold or already returned.").format(item.item_name))
		item.qty = -qty
		item.stock_qty = -qty * flt(item.conversion_factor or 1)
		item.warehouse = settings.quarantine_warehouse if cint(line.get("to_quarantine")) else settings.shop_floor_warehouse
		kept.append(item)
	ret.set("items", kept)
	ret.pos_profile = opening.pos_profile
	ret.is_pos = 1
	ret.update_stock = 1
	ret.calculate_taxes_and_totals()

	approved_by = None
	if _needs_pin(abs(ret.grand_total)):
		approved_by = verify_manager_pin(pin)

	ret.set("payments", [])
	ret.append("payments", {"mode_of_payment": refund_mode, "amount": ret.grand_total})
	ret.calculate_taxes_and_totals()
	if approved_by:
		ret.remarks = _("Return approved by {0}").format(frappe.utils.get_fullname(approved_by))
	ret.insert()
	ret.submit()
	return get_receipt(ret.name)


# Supplier returns and credit notes -------------------------------------------------------------------


@frappe.whitelist()
def list_supplier_returns() -> list[dict]:
	require_app_role("owner", "manager", "stock_clerk", "accountant")
	fields = ["name", "supplier_name", "return_against", "posting_date", "docstatus", "status"]
	if can_see_costs():
		fields.append("grand_total")
	rows = frappe.get_list(
		"Purchase Receipt",
		filters={"is_return": 1, "docstatus": ["<", 2]},
		fields=fields,
		order_by="docstatus asc, creation desc",
		limit_page_length=100,
	)
	for r in rows:
		r["lines"] = frappe.get_all(
			"Purchase Receipt Item", filters={"parent": r.name}, fields=["item_name", "qty", "rejected_qty"]
		)
	return rows


@frappe.whitelist(methods=["POST"])
def submit_supplier_return(name: str) -> dict:
	"""Send back goods prepared as a draft return (e.g. damaged at delivery)."""
	require_app_role("owner", "manager", "stock_clerk")
	doc = frappe.get_doc("Purchase Receipt", name)
	if not doc.is_return:
		frappe.throw(_("{0} is not a return.").format(name))
	doc.submit()
	return {"name": doc.name, "status": doc.status}


@frappe.whitelist()
def receipt_lines(receipt: str) -> list[dict]:
	"""Lines of a delivery note that can still be sent back."""
	require_app_role("owner", "manager", "stock_clerk")
	pr = frappe.get_doc("Purchase Receipt", receipt)
	pr.check_permission("read")
	return [
		{"row": i.name, "item_code": i.item_code, "item_name": i.item_name, "qty": i.qty, "returnable": flt(i.qty) - flt(i.returned_qty)}
		for i in pr.items
		if flt(i.qty) - flt(i.returned_qty) > 0
	]


@frappe.whitelist(methods=["POST"])
def create_supplier_return(receipt: str, lines: str | list) -> dict:
	require_app_role("owner", "manager", "stock_clerk")
	from erpnext.controllers.sales_and_purchase_return import make_return_doc

	lines = {l["row"]: flt(l["qty"]) for l in _rows(lines) if flt(l.get("qty")) > 0}
	ret = make_return_doc("Purchase Receipt", receipt)
	kept = []
	for item in ret.items:
		qty = lines.get(item.purchase_receipt_item)
		if qty:
			item.qty = item.received_qty = -qty
			item.rejected_qty = 0
			item.stock_qty = -qty * flt(item.conversion_factor or 1)
			kept.append(item)
	if not kept:
		frappe.throw(_("Choose what goes back to the supplier."))
	ret.set("items", kept)
	ret.insert()
	ret.submit()
	return {"name": ret.name}


@frappe.whitelist(methods=["POST"])
def create_debit_note(invoice: str, lines: str | list, bill_no: str) -> dict:
	"""Record the supplier's credit note (avoir): it reduces what is owed and the deductible VAT."""
	require_app_role("owner", "manager", "accountant")
	from erpnext.controllers.sales_and_purchase_return import make_return_doc

	from parapilot.api.purchasing import get_invoice

	if not (bill_no or "").strip():
		frappe.throw(_("Enter the number of the supplier's credit note."))
	lines = {l["row"]: flt(l["qty"]) for l in _rows(lines) if flt(l.get("qty")) > 0}
	note = make_return_doc("Purchase Invoice", invoice)
	kept = []
	for item in note.items:
		qty = lines.get(item.purchase_invoice_item)
		if qty:
			item.qty = -qty
			item.received_qty = -qty
			item.stock_qty = -qty * flt(item.conversion_factor or 1)
			kept.append(item)
	if not kept:
		frappe.throw(_("Choose the lines the credit note covers."))
	note.set("items", kept)
	note.update_stock = 0
	# The credit note settles part of the original invoice instead of standing on its own.
	note.update_outstanding_for_self = 0
	note.bill_no = bill_no.strip()
	note.insert()
	note.submit()
	result = get_invoice(invoice)
	result["debit_note"] = note.name
	return result
