"""Customers (spec 5.6): walk-in by default; a named customer found by phone keeps a purchase history.
Only name, phone and marketing consent are stored (Law 09-08)."""

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime

from parapilot.api.pos import SELLERS
from parapilot.utils import require_app_role

FIELDS = ["name", "customer_name", "customer_type", "pp_phone", "pp_ice", "pp_marketing_consent", "pp_marketing_consent_on"]


def normalize_phone(phone: str) -> str:
	"""06 60 75 39 99, +212 660 753 999 and 0660753999 are the same number."""
	digits = "".join(c for c in phone or "" if c.isdigit())
	if digits.startswith("212"):
		digits = "0" + digits[3:]
	return digits


@frappe.whitelist()
def search(query: str = "") -> list[dict]:
	"""Customers by phone (exact) or name, individuals and companies."""
	require_app_role(*SELLERS)
	query = (query or "").strip()
	if not query:
		return []
	phone = normalize_phone(query)
	filters = {"disabled": 0}
	if len(phone) >= 6 and len(phone) == len(query.replace(" ", "").replace("+", "")):
		filters["pp_phone"] = ["like", f"%{phone}%"]
		or_filters = None
	else:
		like = f"%{query}%"
		or_filters = [["customer_name", "like", like], ["pp_ice", "like", like]]
	return frappe.get_list(
		"Customer", filters=filters, or_filters=or_filters, fields=FIELDS, order_by="customer_name asc", limit_page_length=20
	)


@frappe.whitelist(methods=["POST"])
def create(customer_name: str, phone: str, marketing_consent: int = 0) -> dict:
	require_app_role(*SELLERS)
	phone = normalize_phone(phone)
	if not customer_name.strip() or len(phone) < 9:
		frappe.throw(_("Enter a name and a phone number."))
	existing = frappe.db.get_value("Customer", {"pp_phone": phone, "disabled": 0}, FIELDS, as_dict=True)
	if existing:
		return existing
	doc = frappe.get_doc(
		{
			"doctype": "Customer",
			"customer_name": customer_name.strip(),
			"customer_type": "Individual",
			"pp_phone": phone,
			"pp_marketing_consent": cint(marketing_consent),
			"pp_marketing_consent_on": now_datetime() if cint(marketing_consent) else None,
			"customer_group": frappe.db.get_single_value("Selling Settings", "customer_group")
			or frappe.db.get_value("Customer Group", {"is_group": 0}),
			"territory": frappe.db.get_single_value("Selling Settings", "territory")
			or frappe.db.get_value("Territory", {"is_group": 0}),
		}
	).insert()
	return frappe.db.get_value("Customer", doc.name, FIELDS, as_dict=True)


@frappe.whitelist()
def list_customers(search_text: str = "") -> list[dict]:
	"""Named customers with how often and how much they bought."""
	require_app_role("owner", "manager")
	walk_in = frappe.db.get_all("POS Profile", pluck="customer")
	filters: dict = {"disabled": 0, "name": ["not in", walk_in or [""]]}
	or_filters = None
	if search_text:
		like = f"%{search_text.strip()}%"
		or_filters = [["customer_name", "like", like], ["pp_phone", "like", like], ["pp_ice", "like", like]]
	customers = frappe.get_list(
		"Customer", filters=filters, or_filters=or_filters, fields=FIELDS, order_by="customer_name asc", limit_page_length=500
	)
	stats = {
		r.customer: r
		for r in frappe.db.sql(
			"""select customer, count(*) as visits, sum(grand_total) as total, max(posting_date) as last_visit
			from `tabSales Invoice` where docstatus = 1 and is_return = 0 and customer in %s group by customer""",
			[[c.name for c in customers] or [""]],
			as_dict=True,
		)
	}
	for c in customers:
		s = stats.get(c.name)
		c["visits"] = cint(s.visits) if s else 0
		c["total"] = flt(s.total, 2) if s else 0
		c["last_visit"] = str(s.last_visit) if s and s.last_visit else None
	return customers


@frappe.whitelist()
def history(customer: str) -> dict:
	require_app_role("owner", "manager")
	invoices = frappe.get_all(
		"Sales Invoice",
		filters={"customer": customer, "docstatus": 1},
		fields=["name", "posting_date", "grand_total", "is_return"],
		order_by="posting_date desc, creation desc",
		limit_page_length=50,
	)
	items = frappe.get_all(
		"Sales Invoice Item",
		filters={"parent": ["in", [i.name for i in invoices] or [""]]},
		fields=["parent", "item_name", "qty"],
	)
	by_invoice: dict[str, list] = {}
	for i in items:
		by_invoice.setdefault(i.parent, []).append({"item_name": i.item_name, "qty": i.qty})
	return {
		"customer": frappe.db.get_value("Customer", customer, FIELDS, as_dict=True),
		"invoices": [{**i, "posting_date": str(i.posting_date), "lines": by_invoice.get(i.name, [])} for i in invoices],
	}


@frappe.whitelist(methods=["POST"])
def set_consent(customer: str, consent: int) -> dict:
	"""Marketing messages need the customer's recorded consent; the date it was given is kept."""
	require_app_role("owner", "manager", "cashier")
	doc = frappe.get_doc("Customer", customer)
	doc.pp_marketing_consent = cint(consent)
	doc.pp_marketing_consent_on = now_datetime() if cint(consent) else None
	doc.save()
	return frappe.db.get_value("Customer", customer, FIELDS, as_dict=True)
