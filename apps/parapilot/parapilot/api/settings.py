"""Settings and setup wizard (spec 5.1): company, VAT, families, locations, tills, users, product import."""

import json

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime

from parapilot.setup.install import ROLE_PROFILES
from parapilot.utils import get_app_roles, get_settings, get_template_rate, require_app_role
from parapilot.validations.legal_ids import is_valid_ice, normalize_ice

SETUP_STEPS = ["company", "vat", "categories", "families", "locations", "tills", "users", "products"]
SETTINGS_FIELDS = [
	"vat_period",
	"vat_basis",
	"vat_deadline_day",
	"cash_deduction_daily_limit",
	"cash_deduction_monthly_limit",
	"stamp_duty_applies",
	"expiry_warning_days",
	"cashier_discount_limit",
	"return_pin_threshold",
	"receipt_language",
	"round_sales_total",
]
VAT_FIELDS = {"vat_period", "vat_basis", "vat_deadline_day", "cash_deduction_daily_limit", "cash_deduction_monthly_limit", "stamp_duty_applies"}
ROLE_KEYS = {"owner": "ParaPilot Owner", "manager": "ParaPilot Manager", "cashier": "ParaPilot Cashier", "stock_clerk": "ParaPilot Stock Clerk", "accountant": "ParaPilot Accountant"}


def _data(value):
	return frappe._dict(json.loads(value) if isinstance(value, str) else (value or {}))


def _steps_done() -> list[str]:
	try:
		return json.loads(get_settings().setup_steps_done or "[]")
	except ValueError:
		return []


def _mark_step(step: str):
	done = set(_steps_done()) | {step}
	frappe.db.set_single_value("ParaPilot Settings", "setup_steps_done", json.dumps(sorted(done)))
	frappe.clear_document_cache("ParaPilot Settings", "ParaPilot Settings")


def _company_info(company: str | None) -> dict | None:
	if not company:
		return None
	c = frappe.get_doc("Company", company)
	address_name = frappe.db.get_value(
		"Dynamic Link", {"link_doctype": "Company", "link_name": company, "parenttype": "Address"}, "parent"
	)
	address = frappe.db.get_value("Address", address_name, ["address_line1", "city"], as_dict=True) if address_name else None
	return {
		"name": c.name,
		"company_name": c.company_name,
		"abbr": c.abbr,
		"ice": c.get("pp_ice"),
		"if": c.get("pp_if"),
		"rc": c.get("pp_rc"),
		"tp": c.get("pp_tp"),
		"phone": c.phone_no,
		"address_line1": address.address_line1 if address else None,
		"city": address.city if address else None,
	}


@frappe.whitelist()
def get_all() -> dict:
	"""Everything the settings screen and the setup wizard show."""
	require_app_role("owner", "accountant", "manager")
	s = get_settings()
	templates = [
		{"name": t.name, "title": t.title, "rate": get_template_rate(t.name)}
		for t in frappe.get_all("Item Tax Template", filters={"company": s.company, "disabled": 0}, fields=["name", "title"])
	] if s.company else []
	groups = []
	if s.company:
		from parapilot.validations.vat import get_item_group_vat_template

		for g in frappe.get_all("Item Group", filters={"is_group": 0}, fields=["name"], order_by="name asc"):
			template = get_item_group_vat_template(g.name, s.company)
			groups.append({"name": g.name, "vat_template": template, "item_count": frappe.db.count("Item", {"item_group": g.name})})
	return {
		"company": _company_info(s.company),
		"settings": {f: s.get(f) for f in SETTINGS_FIELDS},
		"vat_confirmed_by": s.get("vat_confirmed_by"),
		"vat_confirmed_on": str(s.vat_confirmed_on) if s.get("vat_confirmed_on") else None,
		"templates": templates,
		"item_groups": groups,
		"warehouses": {
			"shop_floor": s.shop_floor_warehouse,
			"back_store": s.back_store_warehouse,
			"quarantine": s.quarantine_warehouse,
		},
		"tills": frappe.get_all("POS Profile", filters={"company": s.company}, fields=["name", "disabled", "warehouse"]) if s.company else [],
		"steps_done": _steps_done(),
		"steps": SETUP_STEPS,
		"can_edit_vat": bool({"owner", "accountant"} & set(get_app_roles())),
		"is_owner": "owner" in get_app_roles(),
	}


@frappe.whitelist(methods=["POST"])
def create_shop(company_name: str, abbr: str, ice: str, if_: str = "", rc: str = "", tp: str = "") -> dict:
	"""Wizard step 1 on an empty site: the company on the CGNC chart, then ParaPilot's defaults."""
	require_app_role("owner")
	from parapilot.setup.company import create_company
	from parapilot.setup.defaults import apply_defaults

	if get_settings().company:
		frappe.throw(_("The shop is already set up."))
	ice = normalize_ice(ice)
	if not is_valid_ice(ice):
		frappe.throw(_("ICE must be exactly 15 digits."))
	company = create_company(company_name.strip(), abbr.strip().upper(), {"pp_ice": ice, "pp_if": if_, "pp_rc": rc, "pp_tp": tp})
	apply_defaults(company)
	_mark_step("company")
	return get_all()


@frappe.whitelist(methods=["POST"])
def save_company(values: str | dict) -> dict:
	require_app_role("owner")
	data = _data(values)
	s = get_settings()
	doc = frappe.get_doc("Company", s.company)
	for field, target in (("ice", "pp_ice"), ("if", "pp_if"), ("rc", "pp_rc"), ("tp", "pp_tp")):
		if field in data:
			doc.set(target, data[field] or None)
	if "phone" in data:
		doc.phone_no = data.phone
	doc.save()
	if data.get("address_line1"):
		name = frappe.db.get_value("Dynamic Link", {"link_doctype": "Company", "link_name": doc.name, "parenttype": "Address"}, "parent")
		address = frappe.get_doc("Address", name) if name else frappe.new_doc("Address")
		address.update(
			{
				"address_title": doc.company_name,
				"address_type": "Billing",
				"address_line1": data.address_line1,
				"city": data.city or "-",
				"country": "Morocco",
				"is_your_company_address": 1,
			}
		)
		if not name:
			address.append("links", {"link_doctype": "Company", "link_name": doc.name})
		address.save()
	_mark_step("company")
	return get_all()


@frappe.whitelist(methods=["POST"])
def save_settings(values: str | dict) -> dict:
	"""VAT settings are for the owner or accountant; the rest for the owner."""
	roles = set(get_app_roles())
	require_app_role("owner", "accountant")
	data = _data(values)
	doc = frappe.get_single("ParaPilot Settings")
	for field in SETTINGS_FIELDS:
		if field not in data:
			continue
		if field not in VAT_FIELDS and "owner" not in roles:
			continue
		doc.set(field, data[field])
	doc.save(ignore_permissions=True)
	if VAT_FIELDS & set(data):
		_mark_step("vat")
	return get_all()


@frappe.whitelist(methods=["POST"])
def confirm_vat() -> dict:
	"""The accountant (or owner) confirms the VAT categories, accounts and declaration settings."""
	require_app_role("owner", "accountant")
	frappe.db.set_single_value(
		"ParaPilot Settings", {"vat_confirmed_by": frappe.session.user, "vat_confirmed_on": now_datetime()}
	)
	frappe.clear_document_cache("ParaPilot Settings", "ParaPilot Settings")
	_mark_step("categories")
	return get_all()


@frappe.whitelist(methods=["POST"])
def set_family(name: str, vat_template: str, new: int = 0) -> dict:
	"""Create a family or change its VAT category (owner or accountant)."""
	require_app_role("owner", "accountant")
	if cint(new):
		if frappe.db.exists("Item Group", name.strip()):
			frappe.throw(_("Family {0} already exists.").format(name))
		doc = frappe.get_doc({"doctype": "Item Group", "item_group_name": name.strip(), "parent_item_group": "All Item Groups"})
	else:
		doc = frappe.get_doc("Item Group", name)
	doc.set("taxes", [{"item_tax_template": vat_template}])
	doc.save(ignore_permissions=True)
	_mark_step("families")
	return get_all()


@frappe.whitelist(methods=["POST"])
def mark_step(step: str) -> dict:
	require_app_role("owner", "accountant")
	if step not in SETUP_STEPS:
		frappe.throw(_("Unknown step."))
	_mark_step(step)
	return get_all()


@frappe.whitelist(methods=["POST"])
def create_till(name: str) -> dict:
	"""One more counter, copying the first till's payment methods and settings."""
	require_app_role("owner")
	s = get_settings()
	if frappe.db.exists("POS Profile", name.strip()):
		frappe.throw(_("Till {0} already exists.").format(name))
	first = frappe.get_all("POS Profile", filters={"company": s.company}, pluck="name", limit=1)
	if not first:
		frappe.throw(_("No till to copy."))
	till = frappe.copy_doc(frappe.get_doc("POS Profile", first[0]))
	till.name = name.strip()
	till.set("applicable_for_users", [])
	till.insert(ignore_permissions=True)
	_mark_step("tills")
	return get_all()


# Users ------------------------------------------------------------------------------------------------


def _user_role(user: str) -> str | None:
	"""The user's ParaPilot role, from their role profile (v16: the role_profiles table)."""
	profiles = set(frappe.get_all("User Role Profile", filters={"parent": user, "parenttype": "User"}, pluck="role_profile"))
	return next((key for key, name in ROLE_KEYS.items() if name in profiles), None)


@frappe.whitelist()
def list_users() -> list[dict]:
	require_app_role("owner")
	members = set(
		frappe.get_all(
			"User Role Profile",
			filters={"parenttype": "User", "role_profile": ["in", list(ROLE_KEYS.values())]},
			pluck="parent",
		)
	)
	users = frappe.get_all(
		"User",
		filters={"name": ["in", list(members) or [""]]},
		fields=["name", "full_name", "enabled", "last_login"],
		order_by="full_name asc",
	)
	for u in users:
		u["role"] = _user_role(u.name)
		u["last_login"] = str(u.last_login) if u.last_login else None
	return users


@frappe.whitelist(methods=["POST"])
def invite_user(email: str, full_name: str, role: str, password: str) -> list[dict]:
	"""A staff account with one of the five roles; the owner gives them their first password."""
	require_app_role("owner")
	if role not in ROLE_KEYS:
		frappe.throw(_("Choose a role."))
	if frappe.db.exists("User", email):
		frappe.throw(_("{0} already has an account.").format(email))
	if len(password or "") < 8:
		frappe.throw(_("The password must have at least 8 characters."))
	frappe.get_doc(
		{
			"doctype": "User",
			"email": email.strip().lower(),
			"first_name": full_name.strip(),
			"send_welcome_email": 0,
			"language": "fr",
			"role_profiles": [{"role_profile": ROLE_KEYS[role]}],
			"new_password": password,
		}
	).insert(ignore_permissions=True)
	_mark_step("users")
	return list_users()


@frappe.whitelist(methods=["POST"])
def update_user(user: str, role: str | None = None, enabled: int | None = None) -> list[dict]:
	require_app_role("owner")
	if user == frappe.session.user and (enabled is not None and not cint(enabled) or role and role != "owner"):
		frappe.throw(_("You cannot remove your own owner access."))
	doc = frappe.get_doc("User", user)
	if role:
		if role not in ROLE_KEYS:
			frappe.throw(_("Choose a role."))
		doc.set("role_profiles", [{"role_profile": ROLE_KEYS[role]}])
	if enabled is not None:
		doc.enabled = cint(enabled)
	doc.save(ignore_permissions=True)
	return list_users()


# Product import ---------------------------------------------------------------------------------------

IMPORT_COLUMNS = ["name", "brand", "lab", "family", "barcode", "price_ttc", "min_stock", "batch_tracking"]


@frappe.whitelist(methods=["POST"])
def import_products(rows: str | list, dry_run: int = 1) -> dict:
	"""Check (and import) products from the spreadsheet template; errors are reported line by line."""
	require_app_role("owner", "manager")
	from parapilot.api.catalog import is_valid_ean13, save_product

	rows = json.loads(rows) if isinstance(rows, str) else rows
	families = set(frappe.get_all("Item Group", filters={"is_group": 0}, pluck="name"))
	seen_barcodes: set[str] = set()
	errors, valid = [], []
	for index, raw in enumerate(rows, start=2):  # line 1 is the header
		r = {k: (str(raw.get(k) or "").strip()) for k in IMPORT_COLUMNS}
		problems = []
		if not r["name"]:
			problems.append(_("name is missing"))
		if r["family"] not in families:
			problems.append(_("unknown family “{0}”").format(r["family"]))
		barcodes = [b.strip() for b in r["barcode"].replace(",", " ").split() if b.strip()]
		for b in barcodes:
			if len(b) == 13 and b.isdigit() and not is_valid_ean13(b):
				problems.append(_("barcode {0} has a wrong check digit").format(b))
			if b in seen_barcodes or frappe.db.exists("Item Barcode", {"barcode": b}):
				problems.append(_("barcode {0} is already used").format(b))
			seen_barcodes.add(b)
		price = None
		if r["price_ttc"]:
			try:
				price = flt(r["price_ttc"].replace(" ", "").replace(",", "."))
			except ValueError:
				price = None
			if not price or price < 0:
				problems.append(_("invalid price “{0}”").format(r["price_ttc"]))
		if problems:
			errors.append({"line": index, "name": r["name"], "errors": problems})
			continue
		valid.append(
			{
				"item_name": r["name"],
				"brand": r["brand"] or None,
				"pp_lab": r["lab"] or None,
				"item_group": r["family"],
				"barcodes": barcodes,
				"price_ttc": price,
				"pp_min_stock": flt(r["min_stock"].replace(",", ".")) if r["min_stock"] else 0,
				"has_batch_no": r["batch_tracking"].lower() not in ("non", "no", "0", "false") and r["family"] != "Accessoires",
			}
		)
	imported = 0
	if not cint(dry_run) and not errors:
		for product in valid:
			save_product(product)
			imported += 1
		_mark_step("products")
	return {"valid": len(valid), "errors": errors, "imported": imported}
