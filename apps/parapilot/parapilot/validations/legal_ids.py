import re

import frappe
from frappe import _

ICE_PATTERN = re.compile(r"\d{15}")


def normalize_ice(value: str | None) -> str | None:
	"""Strip spaces and dots people type when copying an ICE from paper."""
	if not value:
		return value
	return re.sub(r"[\s.\-]", "", value)


def is_valid_ice(value: str | None) -> bool:
	return bool(value) and bool(ICE_PATTERN.fullmatch(value))


def _check_ice(doc, fieldname: str, label: str):
	value = normalize_ice(doc.get(fieldname))
	doc.set(fieldname, value)
	if value and not is_valid_ice(value):
		frappe.throw(_("{0} must be exactly 15 digits.").format(label), title=_("Invalid ICE"))


def validate_company(doc, method=None):
	_check_ice(doc, "pp_ice", _("ICE"))


def validate_party_ice(doc, method=None):
	_check_ice(doc, "pp_ice", _("ICE"))


def warn_missing_company_ice(doc, method=None):
	"""A supplier invoice that does not show our ICE puts the VAT deduction at risk (CGI art. 145)."""
	if doc.get("is_return") or doc.get("pp_company_ice_on_invoice"):
		return
	frappe.msgprint(
		_(
			"Check that the supplier invoice shows your company's ICE. Without it, the VAT on this invoice may not be deductible."
		),
		title=_("Company ICE missing on the invoice?"),
		indicator="orange",
	)
