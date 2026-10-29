import json

import frappe
from frappe import _
from frappe.utils import cint, flt

from parapilot.utils import can_see_costs, get_settings, get_template_rate
from parapilot.validations.vat import get_item_group_vat_template

PRODUCT_FIELDS = [
	"name",
	"item_name",
	"brand",
	"pp_lab",
	"item_group",
	"image",
	"disabled",
	"has_batch_no",
	"is_stock_item",
	"stock_uom",
	"pp_min_stock",
	"pp_is_tester",
]
COST_FIELDS = ["valuation_rate", "last_purchase_rate"]


def is_valid_ean13(code: str) -> bool:
	if len(code) != 13 or not code.isdigit():
		return False
	digits = [int(c) for c in code]
	checksum = sum(d * (3 if i % 2 else 1) for i, d in enumerate(digits[:12]))
	return (10 - checksum % 10) % 10 == digits[12]


def _item_vat(item_codes: list[str], groups: dict[str, str], company: str) -> dict[str, dict]:
	"""VAT template per item: the item's own row first, then its group, as ERPNext resolves it."""
	own = {}
	for row in frappe.get_all(
		"Item Tax",
		filters={"parenttype": "Item", "parent": ["in", item_codes]},
		fields=["parent", "item_tax_template"],
		order_by="idx asc",
	):
		own.setdefault(row.parent, row.item_tax_template)
	by_group: dict[str, str | None] = {}
	result = {}
	for code in item_codes:
		template = own.get(code)
		if not template:
			group = groups[code]
			if group not in by_group:
				by_group[group] = get_item_group_vat_template(group, company)
			template = by_group[group]
		result[code] = {"template": template, "rate": get_template_rate(template)}
	return result


def _enrich(items: list[dict]) -> list[dict]:
	if not items:
		return items
	settings = get_settings()
	codes = [i["name"] for i in items]

	prices = {}
	for p in frappe.get_all(
		"Item Price",
		filters={"price_list": settings.selling_price_list, "item_code": ["in", codes]},
		fields=["item_code", "price_list_rate", "customer"],
		order_by="valid_from desc",
	):
		if not p.customer:
			prices.setdefault(p.item_code, p.price_list_rate)

	barcodes: dict[str, list[str]] = {}
	for b in frappe.get_all(
		"Item Barcode",
		filters={"parenttype": "Item", "parent": ["in", codes]},
		fields=["parent", "barcode"],
		order_by="idx asc",
	):
		barcodes.setdefault(b.parent, []).append(b.barcode)

	sellable = [w for w in (settings.shop_floor_warehouse, settings.back_store_warehouse) if w]
	stock: dict[str, float] = {}
	for b in frappe.get_all(
		"Bin",
		filters={"item_code": ["in", codes], "warehouse": ["in", sellable or [""]]},
		fields=["item_code", "actual_qty"],
	):
		stock[b.item_code] = stock.get(b.item_code, 0) + flt(b.actual_qty)

	vat = _item_vat(codes, {i["name"]: i["item_group"] for i in items}, settings.company)

	for item in items:
		code = item.pop("name")
		item["item_code"] = code
		item["price_ttc"] = prices.get(code)
		item["barcodes"] = barcodes.get(code, [])
		item["stock_qty"] = stock.get(code, 0)
		item["vat_template"] = vat[code]["template"]
		item["vat_rate"] = vat[code]["rate"]
	return items


@frappe.whitelist()
def list_products(
	search: str | None = None,
	item_group: str | None = None,
	brand: str | None = None,
	status: str = "active",
	start: int = 0,
	page_length: int = 50,
) -> dict:
	frappe.has_permission("Item", "read", throw=True)
	start, page_length = cint(start), min(cint(page_length) or 50, 500)

	filters: dict = {"is_fixed_asset": 0, "has_variants": 0}
	if status in ("active", "disabled"):
		filters["disabled"] = 1 if status == "disabled" else 0
	if item_group:
		filters["item_group"] = ["descendants of (inclusive)", item_group]
	if brand:
		filters["brand"] = brand

	or_filters = None
	if search:
		search = search.strip()
		by_barcode = frappe.db.get_value("Item Barcode", {"barcode": search, "parenttype": "Item"}, "parent")
		if by_barcode:
			filters["name"] = by_barcode
		else:
			like = f"%{search}%"
			or_filters = [["item_name", "like", like], ["name", "like", like], ["brand", "like", like]]

	fields = PRODUCT_FIELDS + (COST_FIELDS if can_see_costs() else [])
	rows = frappe.get_list(
		"Item",
		filters=filters,
		or_filters=or_filters,
		fields=fields,
		order_by="item_name asc",
		start=start,
		page_length=page_length + 1,
	)
	has_more = len(rows) > page_length
	return {"items": _enrich(rows[:page_length]), "has_more": has_more, "start": start}


@frappe.whitelist()
def get_product(item_code: str) -> dict:
	frappe.has_permission("Item", "read", doc=item_code, throw=True)
	settings = get_settings()
	fields = PRODUCT_FIELDS + (COST_FIELDS if can_see_costs() else [])
	item = frappe.db.get_value("Item", item_code, fields, as_dict=True)
	if not item:
		frappe.throw(_("Product {0} not found.").format(item_code), frappe.DoesNotExistError)
	product = _enrich([item])[0]
	product["default_supplier"] = frappe.db.get_value(
		"Item Default", {"parent": item_code, "company": settings.company}, "default_supplier"
	)
	product["stock_by_warehouse"] = frappe.get_all(
		"Bin",
		filters={"item_code": item_code, "actual_qty": ["!=", 0]},
		fields=["warehouse", "actual_qty"],
	)
	return product


@frappe.whitelist()
def get_form_options() -> dict:
	"""Pick lists for the product form, with the VAT category each item group implies."""
	frappe.has_permission("Item", "read", throw=True)
	settings = get_settings()
	groups = []
	for g in frappe.get_all(
		"Item Group", filters={"is_group": 0}, fields=["name", "parent_item_group"], order_by="name asc"
	):
		template = get_item_group_vat_template(g.name, settings.company)
		groups.append(
			{
				"name": g.name,
				"vat_template": template,
				"vat_title": frappe.get_cached_value("Item Tax Template", template, "title") if template else None,
				"vat_rate": get_template_rate(template),
			}
		)
	return {
		"item_groups": groups,
		"brands": frappe.get_all("Brand", pluck="name", order_by="name asc"),
		"labs": frappe.get_all("Manufacturer", pluck="name", order_by="name asc"),
		"suppliers": frappe.get_all(
			"Supplier",
			filters={"disabled": 0},
			fields=["name", "supplier_name"],
			order_by="supplier_name asc",
		),
		"can_edit_price": bool(frappe.has_permission("Item Price", "write")),
		"can_see_costs": can_see_costs(),
	}


def _ensure_named(doctype: str, fieldname: str, value: str | None):
	"""Brands and labs are pick lists; a new name typed in the form is created on save."""
	if value and not frappe.db.exists(doctype, value):
		frappe.get_doc({"doctype": doctype, fieldname: value}).insert()


@frappe.whitelist(methods=["POST"])
def save_product(product: str | dict) -> dict:
	data = frappe._dict(json.loads(product) if isinstance(product, str) else product)
	settings = get_settings()

	barcodes = [b.strip() for b in (data.barcodes or []) if b and b.strip()]
	for code in barcodes:
		if len(code) == 13 and code.isdigit() and not is_valid_ean13(code):
			frappe.throw(_("Barcode {0} is not a valid EAN-13 (wrong check digit).").format(code))

	_ensure_named("Brand", "brand", data.brand)
	_ensure_named("Manufacturer", "short_name", data.pp_lab)

	if data.item_code:
		doc = frappe.get_doc("Item", data.item_code)
	else:
		doc = frappe.new_doc("Item")
		doc.stock_uom = "Nos"
		doc.is_stock_item = 0 if data.item_group == "Frais généraux" else 1
		doc.is_sales_item = doc.is_stock_item
		doc.is_purchase_item = 1
		doc.include_item_in_manufacturing = 0

	doc.item_name = data.item_name
	doc.item_group = data.item_group
	doc.brand = data.brand or None
	doc.pp_lab = data.pp_lab or None
	doc.image = data.image or None
	doc.pp_min_stock = flt(data.pp_min_stock)
	doc.pp_is_tester = cint(data.pp_is_tester)
	doc.disabled = cint(data.disabled)
	# Batch tracking cannot change once stock moved; ERPNext enforces that.
	if data.has_batch_no is not None:
		doc.has_batch_no = cint(data.has_batch_no)
		doc.has_expiry_date = doc.has_batch_no

	existing = {row.barcode: row for row in doc.barcodes}
	doc.set("barcodes", [])
	for code in barcodes:
		row = existing.get(code)
		doc.append(
			"barcodes",
			{
				"barcode": code,
				"barcode_type": row.barcode_type
				if row
				else ("EAN-13" if len(code) == 13 and code.isdigit() else ""),
			},
		)

	defaults = next((d for d in doc.item_defaults if d.company == settings.company), None)
	if not defaults:
		defaults = doc.append("item_defaults", {"company": settings.company})
	defaults.default_warehouse = settings.shop_floor_warehouse
	defaults.default_supplier = data.default_supplier or None
	defaults.default_price_list = settings.selling_price_list

	doc.save()

	warnings = []
	if data.price_ttc is not None and data.price_ttc != "":
		_set_selling_price(doc, flt(data.price_ttc), settings)
		warnings += _price_warnings(doc, flt(data.price_ttc))

	return {"item_code": doc.name, "warnings": warnings}


def _set_selling_price(item, price_ttc: float, settings):
	if price_ttc < 0:
		frappe.throw(_("The price cannot be negative."))
	name = frappe.db.get_value(
		"Item Price",
		{
			"item_code": item.name,
			"price_list": settings.selling_price_list,
			"customer": ["is", "not set"],
		},
	)
	if name:
		price = frappe.get_doc("Item Price", name)
		if flt(price.price_list_rate, 2) == flt(price_ttc, 2):
			return
		price.price_list_rate = price_ttc
		price.save()
	else:
		frappe.get_doc(
			{
				"doctype": "Item Price",
				"item_code": item.name,
				"price_list": settings.selling_price_list,
				"uom": item.stock_uom,
				"price_list_rate": price_ttc,
			}
		).insert()


def _price_warnings(item, price_ttc: float) -> list[dict]:
	"""Warn when the selling price HT is below the last cost HT, with the loss per unit."""
	if not item.last_purchase_rate:
		return []
	rate = get_template_rate(
		_item_vat([item.name], {item.name: item.item_group}, get_settings().company)[item.name]["template"]
	)
	price_ht = flt(price_ttc / (1 + flt(rate) / 100), 2)
	cost_ht = flt(item.last_purchase_rate, 2)
	if price_ht >= cost_ht:
		return []
	return [{"code": "below_cost", "loss_per_unit_ht": flt(cost_ht - price_ht, 2)}]
