import frappe
from frappe import _
from frappe.utils.nestedset import get_ancestors_of


def _skip() -> bool:
	return bool(frappe.flags.in_install or frappe.flags.in_migrate or frappe.flags.in_patch)


def get_item_group_vat_template(item_group: str, company: str | None = None) -> str | None:
	"""Item Tax Template set on the item group or its nearest ancestor, as ERPNext resolves it."""
	for group in [item_group, *get_ancestors_of("Item Group", item_group)]:
		for row in frappe.get_cached_doc("Item Group", group).taxes:
			if not row.item_tax_template:
				continue
			disabled, template_company = frappe.get_cached_value(
				"Item Tax Template", row.item_tax_template, ["disabled", "company"]
			)
			if not disabled and (not company or template_company == company):
				return row.item_tax_template
	return None


def get_item_vat_template(item, company: str | None = None) -> str | None:
	for row in item.get("taxes") or []:
		if row.item_tax_template:
			return row.item_tax_template
	return get_item_group_vat_template(item.item_group, company) if item.item_group else None


def validate_item(doc, method=None):
	"""An item that is sold or bought must belong to an item group with a VAT category."""
	if _skip() or doc.get("is_fixed_asset") or doc.get("disabled"):
		return
	if not (doc.get("is_sales_item") or doc.get("is_purchase_item")):
		return
	if not get_item_vat_template(doc):
		frappe.throw(
			_("Item group {0} has no VAT category. Set one on the item group first.").format(
				frappe.bold(doc.item_group)
			),
			title=_("VAT category missing"),
		)


def validate_items_have_vat_category(doc, method=None):
	"""Nobody can sell or buy an item whose VAT rate is unknown.

	Every line needs a template, including expense lines without an item code: the TTC tax templates
	carry one row per rate, so a line without an item tax map would be taxed at all rates at once.
	"""
	if _skip():
		return
	missing = [
		row.item_code or row.item_name or str(row.idx)
		for row in doc.get("items") or []
		if not row.get("item_tax_template")
	]
	if missing:
		frappe.throw(
			_("These items have no VAT category: {0}").format(", ".join(sorted(set(missing)))),
			title=_("VAT category missing"),
		)
