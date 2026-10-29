"""Stock (spec 5.4): overview, expiry board, transfers, write-offs and stock counts."""

import json

import frappe
from frappe import _
from frappe.utils import add_days, cint, date_diff, flt, getdate, today

from parapilot.utils import can_see_costs, get_app_roles, get_settings, require_app_role

STOCK_ROLES = ("owner", "manager", "stock_clerk")

# Write-off reason -> expense account number in chart_ma (one account each, so losses are visible).
WRITE_OFF_ACCOUNTS = {"breakage": "61851", "theft": "61852", "expired": "61853", "tester": "61854"}


def _warehouses() -> dict[str, str]:
	s = get_settings()
	return {
		"shop_floor": s.shop_floor_warehouse,
		"back_store": s.back_store_warehouse,
		"quarantine": s.quarantine_warehouse,
	}


def _role_of(warehouse: str) -> str | None:
	return next((role for role, name in _warehouses().items() if name == warehouse), None)


def _data(value):
	return frappe._dict(json.loads(value) if isinstance(value, str) else value)


@frappe.whitelist()
def stock_overview(search: str | None = None, item_group: str | None = None, low_only: int = 0) -> dict:
	"""Quantity per location for every stock item, with value at cost for those allowed to see costs."""
	require_app_role(*STOCK_ROLES, "accountant")
	warehouses = _warehouses()
	filters: dict = {"disabled": 0, "is_stock_item": 1, "has_variants": 0}
	if item_group:
		filters["item_group"] = ["descendants of (inclusive)", item_group]
	or_filters = None
	if search:
		like = f"%{search.strip()}%"
		by_barcode = frappe.db.get_value("Item Barcode", {"barcode": search.strip()}, "parent")
		if by_barcode:
			filters["name"] = by_barcode
		else:
			or_filters = [["item_name", "like", like], ["brand", "like", like], ["name", "like", like]]
	items = frappe.get_list(
		"Item",
		filters=filters,
		or_filters=or_filters,
		fields=["name", "item_name", "brand", "item_group", "pp_min_stock", "has_batch_no"],
		order_by="item_name asc",
		limit_page_length=1000,
	)
	codes = [i.name for i in items] or [""]
	bins: dict[str, dict] = {}
	for b in frappe.get_all(
		"Bin",
		filters={"item_code": ["in", codes], "warehouse": ["in", [w for w in warehouses.values() if w]]},
		fields=["item_code", "warehouse", "actual_qty", "stock_value"],
	):
		entry = bins.setdefault(b.item_code, {"qty": {}, "value": 0.0})
		entry["qty"][_role_of(b.warehouse)] = flt(b.actual_qty)
		entry["value"] += flt(b.stock_value)
	show_costs = can_see_costs()
	rows = []
	for i in items:
		entry = bins.get(i.name, {"qty": {}, "value": 0.0})
		sellable = entry["qty"].get("shop_floor", 0) + entry["qty"].get("back_store", 0)
		low = bool(i.pp_min_stock) and sellable < flt(i.pp_min_stock)
		if cint(low_only) and not low:
			continue
		row = {
			"item_code": i.name,
			"item_name": i.item_name,
			"brand": i.brand,
			"item_group": i.item_group,
			"has_batch_no": i.has_batch_no,
			"min_stock": flt(i.pp_min_stock),
			"shop_floor": entry["qty"].get("shop_floor", 0),
			"back_store": entry["qty"].get("back_store", 0),
			"quarantine": entry["qty"].get("quarantine", 0),
			"low": low,
		}
		if show_costs:
			row["value"] = flt(entry["value"], 2)
		rows.append(row)
	return {"items": rows, "show_costs": show_costs}


def batch_balances(warehouses: list[str], item_code: str | None = None) -> list[dict]:
	"""Quantity and value at cost of each batch in each warehouse, from the batch ledger."""
	conditions = ["b.docstatus = 1", "b.is_cancelled = 0", "e.warehouse in %(warehouses)s"]
	if item_code:
		conditions.append("b.item_code = %(item_code)s")
	return frappe.db.sql(
		f"""select b.item_code, e.batch_no, e.warehouse, sum(e.qty) as qty,
			sum(e.stock_value_difference) as value, bt.expiry_date, bt.description as lot
		from `tabSerial and Batch Entry` e
		join `tabSerial and Batch Bundle` b on b.name = e.parent
		join `tabBatch` bt on bt.name = e.batch_no
		where {" and ".join(conditions)}
		group by b.item_code, e.batch_no, e.warehouse
		having sum(e.qty) > 0""",
		{"warehouses": warehouses, "item_code": item_code},
		as_dict=True,
	)


@frappe.whitelist()
def expiry_board(days: int = 90) -> dict:
	"""Batches that are expired or expire within 30, 60 and 90 days, with quantity and value at cost."""
	require_app_role(*STOCK_ROLES, "accountant")
	warehouses = _warehouses()
	horizon = add_days(today(), cint(days) or 90)
	balances = [
		b
		for b in batch_balances([w for w in warehouses.values() if w])
		if b.expiry_date and getdate(b.expiry_date) <= getdate(horizon)
	]
	names = dict(
		frappe.get_all("Item", filters={"name": ["in", [b.item_code for b in balances] or [""]]}, fields=["name", "item_name"], as_list=True)
	)
	show_costs = can_see_costs()
	rows = []
	for b in sorted(balances, key=lambda b: b.expiry_date):
		left = date_diff(b.expiry_date, today())
		bucket = "expired" if left < 0 else "30" if left <= 30 else "60" if left <= 60 else "90"
		row = {
			"item_code": b.item_code,
			"item_name": names.get(b.item_code),
			"batch_no": b.batch_no,
			"lot": b.lot or b.batch_no,
			"warehouse": _role_of(b.warehouse),
			"expiry_date": str(b.expiry_date),
			"days_left": left,
			"bucket": bucket,
			"qty": flt(b.qty),
		}
		if show_costs:
			row["value"] = flt(b.value, 2)
		rows.append(row)
	totals = {}
	for r in rows:
		t = totals.setdefault(r["bucket"], {"batches": 0, "qty": 0.0, "value": 0.0})
		t["batches"] += 1
		t["qty"] += r["qty"]
		t["value"] = flt(t["value"] + r.get("value", 0), 2)
	return {"batches": rows, "totals": totals, "show_costs": show_costs}


@frappe.whitelist()
def item_batches(item_code: str, warehouse_role: str = "shop_floor") -> list[dict]:
	"""Batches of one item in a location, earliest expiry first (for write-offs and counts)."""
	require_app_role(*STOCK_ROLES)
	warehouse = _warehouses().get(warehouse_role)
	return [
		{"batch_no": b.batch_no, "lot": b.lot or b.batch_no, "expiry_date": str(b.expiry_date) if b.expiry_date else None, "qty": flt(b.qty)}
		for b in sorted(batch_balances([warehouse], item_code), key=lambda b: str(b.expiry_date or "9999"))
	]


def _stock_entry(purpose: str, source: str | None, target: str | None, lines: list, expense_account: str | None = None):
	settings = get_settings()
	company = frappe.get_cached_doc("Company", settings.company)
	entry = frappe.get_doc(
		{
			"doctype": "Stock Entry",
			"stock_entry_type": purpose,
			"company": settings.company,
			"from_warehouse": source,
			"to_warehouse": target,
		}
	)
	for line in lines:
		qty = flt(line.get("qty"))
		if qty <= 0:
			continue
		row = {
			"item_code": line["item_code"],
			"qty": qty,
			"s_warehouse": source,
			"t_warehouse": target,
			"cost_center": company.cost_center,
		}
		if line.get("batch_no"):
			row.update({"batch_no": line["batch_no"], "use_serial_batch_fields": 1})
		if expense_account:
			row["expense_account"] = expense_account
		entry.append("items", row)
	if not entry.items:
		frappe.throw(_("Scan at least one product."))
	entry.insert()
	entry.submit()
	return entry


@frappe.whitelist(methods=["POST"])
def transfer(lines: str | list, source: str = "back_store", target: str = "shop_floor") -> dict:
	"""Move stock between locations; batches leave first-expired-first-out unless one is chosen."""
	require_app_role(*STOCK_ROLES)
	lines = json.loads(lines) if isinstance(lines, str) else lines
	warehouses = _warehouses()
	if source == target or source not in warehouses or target not in warehouses:
		frappe.throw(_("Choose two different locations."))
	entry = _stock_entry("Material Transfer", warehouses[source], warehouses[target], lines)
	return {"name": entry.name}


@frappe.whitelist(methods=["POST"])
def write_off(lines: str | list, reason: str, source: str = "shop_floor", note: str | None = None) -> dict:
	"""Remove stock with a reason; each reason posts to its own expense account."""
	require_app_role(*STOCK_ROLES)
	from parapilot.setup.company import account_by_number

	lines = json.loads(lines) if isinstance(lines, str) else lines
	if reason not in WRITE_OFF_ACCOUNTS:
		frappe.throw(_("Choose a reason."))
	settings = get_settings()
	account = account_by_number(settings.company, WRITE_OFF_ACCOUNTS[reason]) or frappe.get_cached_value(
		"Company", settings.company, "stock_adjustment_account"
	)
	warehouse = _warehouses().get(source)
	entry = _stock_entry("Material Issue", warehouse, None, lines, expense_account=account)
	entry.db_set("remarks", f"{reason}: {note}" if note else reason)
	return {"name": entry.name, "value": flt(entry.total_outgoing_value, 2) if can_see_costs() else None}


# Stock counts (inventaire) ------------------------------------------------------------------------


@frappe.whitelist()
def count_sheet(warehouse_role: str = "shop_floor", item_group: str | None = None) -> dict:
	"""What to count: every stock item of the location (and family), one row per batch in stock."""
	require_app_role(*STOCK_ROLES)
	warehouse = _warehouses().get(warehouse_role)
	filters: dict = {"disabled": 0, "is_stock_item": 1, "has_variants": 0}
	if item_group:
		filters["item_group"] = ["descendants of (inclusive)", item_group]
	items = frappe.get_all("Item", filters=filters, fields=["name", "item_name", "has_batch_no"], order_by="item_name asc")
	barcodes: dict[str, list[str]] = {}
	for b in frappe.get_all("Item Barcode", filters={"parenttype": "Item"}, fields=["parent", "barcode"]):
		barcodes.setdefault(b.parent, []).append(b.barcode)
	batches: dict[str, list] = {}
	for b in batch_balances([warehouse]):
		batches.setdefault(b.item_code, []).append(b)
	rows = []
	for i in items:
		base = {"item_code": i.name, "item_name": i.item_name, "barcodes": barcodes.get(i.name, [])}
		if i.has_batch_no:
			for b in sorted(batches.get(i.name, []), key=lambda b: str(b.expiry_date or "")):
				rows.append({**base, "batch_no": b.batch_no, "lot": b.lot or b.batch_no, "expiry_date": str(b.expiry_date) if b.expiry_date else None})
		else:
			rows.append({**base, "batch_no": None})
	# The expected quantities are not sent: the count is blind.
	return {"warehouse": warehouse, "warehouse_role": warehouse_role, "rows": rows}


@frappe.whitelist(methods=["POST"])
def submit_count(warehouse_role: str, rows: str | list, item_group: str | None = None) -> dict:
	"""Save the count as a draft Stock Reconciliation; a manager approves (submits) it."""
	require_app_role(*STOCK_ROLES)
	rows = json.loads(rows) if isinstance(rows, str) else rows
	warehouse = _warehouses().get(warehouse_role)
	settings = get_settings()
	doc = frappe.get_doc(
		{
			"doctype": "Stock Reconciliation",
			"company": settings.company,
			"purpose": "Stock Reconciliation",
			"set_warehouse": warehouse,
			"expense_account": frappe.get_cached_value("Company", settings.company, "stock_adjustment_account"),
		}
	)
	# Keep only real differences: ERPNext refuses a reconciliation where nothing changes.
	by_batch = {(b.item_code, b.batch_no): flt(b.qty) for b in batch_balances([warehouse])}
	for r in rows:
		if r.get("counted") is None or r.get("counted") == "":
			continue
		counted = flt(r["counted"])
		if r.get("batch_no"):
			expected = by_batch.get((r["item_code"], r["batch_no"]), 0)
		else:
			expected = flt(frappe.db.get_value("Bin", {"item_code": r["item_code"], "warehouse": warehouse}, "actual_qty"))
		if counted == expected:
			continue
		row = {"item_code": r["item_code"], "warehouse": warehouse, "qty": counted}
		if r.get("batch_no"):
			row.update({"batch_no": r["batch_no"], "use_serial_batch_fields": 1})
		doc.append("items", row)
	if not doc.items:
		return {"name": None, "differences": 0}
	doc.insert()
	return get_count(doc.name)


@frappe.whitelist()
def list_counts() -> list[dict]:
	require_app_role(*STOCK_ROLES)
	rows = frappe.get_list(
		"Stock Reconciliation",
		filters={"docstatus": ["<", 2], "purpose": "Stock Reconciliation"},
		fields=["name", "posting_date", "set_warehouse", "docstatus", "difference_amount", "owner"],
		order_by="creation desc",
		limit_page_length=100,
	)
	for r in rows:
		r["warehouse_role"] = _role_of(r.set_warehouse)
	return rows


@frappe.whitelist()
def get_count(name: str) -> dict:
	doc = frappe.get_doc("Stock Reconciliation", name)
	doc.check_permission("read")
	show_costs = can_see_costs()
	return {
		"name": doc.name,
		"docstatus": doc.docstatus,
		"posting_date": str(doc.posting_date),
		"warehouse_role": _role_of(doc.set_warehouse or (doc.items[0].warehouse if doc.items else "")),
		"counted_by": frappe.utils.get_fullname(doc.owner),
		"differences": len(doc.items),
		"difference_amount": flt(doc.difference_amount, 2) if show_costs else None,
		"rows": [
			{
				"item_code": i.item_code,
				"item_name": i.item_name,
				"lot": frappe.db.get_value("Batch", i.batch_no, "description") or i.batch_no if i.batch_no else None,
				"expected": flt(i.current_qty),
				"counted": flt(i.qty),
				"difference": flt(i.qty) - flt(i.current_qty),
				**({"amount_difference": flt(i.amount_difference, 2)} if show_costs else {}),
			}
			for i in doc.items
		],
		"can_approve": doc.docstatus == 0 and bool({"owner", "manager"} & set(get_app_roles())),
	}


@frappe.whitelist(methods=["POST"])
def approve_count(name: str) -> dict:
	require_app_role("owner", "manager")
	doc = frappe.get_doc("Stock Reconciliation", name)
	doc.submit()
	return get_count(doc.name)
