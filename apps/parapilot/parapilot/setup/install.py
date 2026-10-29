"""Idempotent install: runs after install and after every migrate, so changes here reach existing sites."""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.custom.doctype.property_setter.property_setter import make_property_setter
from frappe.permissions import add_permission, update_permission_property

OWNER = "ParaPilot Owner"
MANAGER = "ParaPilot Manager"
CASHIER = "ParaPilot Cashier"
STOCK_CLERK = "ParaPilot Stock Clerk"
ACCOUNTANT = "ParaPilot Accountant"
AI = "ParaPilot AI"

ROLES = [OWNER, MANAGER, CASHIER, STOCK_CLERK, ACCOUNTANT, AI]

# Owner, Manager and Accountant get ERPNext's standard roles; the ParaPilot role marks them for the web app.
ROLE_PROFILES = {
	"ParaPilot Owner": [
		OWNER,
		"System Manager",
		"Accounts Manager",
		"Accounts User",
		"Stock Manager",
		"Stock User",
		"Sales Manager",
		"Sales User",
		"Sales Master Manager",
		"Purchase Manager",
		"Purchase User",
		"Purchase Master Manager",
		"Item Manager",
	],
	"ParaPilot Manager": [
		MANAGER,
		"Accounts User",
		"Stock Manager",
		"Stock User",
		"Sales Manager",
		"Sales User",
		"Sales Master Manager",
		"Purchase Manager",
		"Purchase User",
		"Purchase Master Manager",
		"Item Manager",
	],
	"ParaPilot Accountant": [ACCOUNTANT, "Accounts Manager", "Accounts User", "Purchase User"],
	"ParaPilot Cashier": [CASHIER],
	"ParaPilot Stock Clerk": [STOCK_CLERK],
}

R = ["read"]
RW = ["read", "write", "create"]
RWS = ["read", "write", "create", "submit", "print"]

_REFERENCE = [
	"Company",
	"Currency",
	"UOM",
	"Item",
	"Item Group",
	"Brand",
	"Manufacturer",
	"Item Price",
	"Price List",
	"Item Tax Template",
	"Batch",
	"Bin",
	"Warehouse",
	"Account",
]

# Cashier, Stock Clerk and AI have no standard ERPNext role: their permissions are listed in full.
CUSTOM_ROLE_PERMISSIONS: dict[str, dict[str, list[str]]] = {
	CASHIER: {
		**{dt: R for dt in _REFERENCE},
		"POS Profile": R,
		"Mode of Payment": R,
		"Sales Taxes and Charges Template": R,
		"Customer Group": R,
		"Territory": R,
		"POS Invoice": RWS,
		"Sales Invoice": RWS,
		"POS Opening Entry": RWS,
		"POS Closing Entry": RWS,
		"Serial and Batch Bundle": RWS,
		"Customer": RW,
		"Contact": RW,
		"Address": RW,
	},
	STOCK_CLERK: {
		**{dt: R for dt in _REFERENCE},
		"Supplier": R,
		"Purchase Taxes and Charges Template": R,
		"Purchase Order": RW,
		"Purchase Receipt": RWS,
		"Stock Entry": RWS,
		"Stock Reconciliation": RW,
		"Serial and Batch Bundle": RWS,
		"Batch": RW,
	},
	# The AI service account reads and prepares drafts. It can never submit, cancel, delete or touch
	# customers, prices or VAT settings.
	AI: {
		**{dt: R for dt in _REFERENCE},
		"Supplier": R,
		"Sales Invoice": R,
		"POS Invoice": R,
		"Stock Ledger Entry": R,
		"GL Entry": R,
		"Purchase Order": RW,
		"Purchase Receipt": RW,
		"Purchase Invoice": RW,
	},
}

CUSTOM_FIELDS = {
	"Company": [
		{
			"fieldname": "pp_legal_ids_section",
			"fieldtype": "Section Break",
			"label": "Moroccan Legal IDs",
			"insert_after": "tax_id",
		},
		{
			"fieldname": "pp_ice",
			"fieldtype": "Data",
			"label": "ICE",
			"length": 15,
			"insert_after": "pp_legal_ids_section",
			"description": "Identifiant Commun de l'Entreprise, 15 digits",
		},
		{"fieldname": "pp_if", "fieldtype": "Data", "label": "IF", "insert_after": "pp_ice"},
		{"fieldname": "pp_legal_ids_cb", "fieldtype": "Column Break", "insert_after": "pp_if"},
		{"fieldname": "pp_rc", "fieldtype": "Data", "label": "RC", "insert_after": "pp_legal_ids_cb"},
		{"fieldname": "pp_tp", "fieldtype": "Data", "label": "Taxe Professionnelle", "insert_after": "pp_rc"},
	],
	"Supplier": [
		{"fieldname": "pp_ice", "fieldtype": "Data", "label": "ICE", "length": 15, "insert_after": "tax_id"},
		{"fieldname": "pp_if", "fieldtype": "Data", "label": "IF", "insert_after": "pp_ice"},
		{
			"fieldname": "pp_terms_section",
			"fieldtype": "Section Break",
			"label": "Purchasing Terms",
			"insert_after": "pp_if",
		},
		{
			"fieldname": "pp_min_order_amount",
			"fieldtype": "Currency",
			"label": "Minimum Order Amount (HT)",
			"insert_after": "pp_terms_section",
		},
		{
			"fieldname": "pp_lead_time_days",
			"fieldtype": "Int",
			"label": "Delivery Lead Time (Days)",
			"insert_after": "pp_min_order_amount",
		},
		{
			"fieldname": "pp_free_unit_terms",
			"fieldtype": "Small Text",
			"label": "Free Unit Terms",
			"insert_after": "pp_lead_time_days",
		},
	],
	"Customer": [
		{"fieldname": "pp_ice", "fieldtype": "Data", "label": "ICE", "length": 15, "insert_after": "tax_id"},
		{
			"fieldname": "pp_phone",
			"fieldtype": "Data",
			"options": "Phone",
			"label": "Phone",
			"insert_after": "pp_ice",
			"search_index": 1,
			"in_standard_filter": 1,
		},
		{
			"fieldname": "pp_marketing_consent",
			"fieldtype": "Check",
			"label": "Marketing Consent (Law 09-08)",
			"insert_after": "pp_phone",
		},
		{
			"fieldname": "pp_marketing_consent_on",
			"fieldtype": "Datetime",
			"label": "Consent Recorded On",
			"insert_after": "pp_marketing_consent",
			"depends_on": "pp_marketing_consent",
			"read_only": 1,
		},
	],
	"Item": [
		{
			"fieldname": "pp_lab",
			"fieldtype": "Link",
			"label": "Lab",
			"options": "Manufacturer",
			"insert_after": "brand",
		},
		{"fieldname": "pp_is_tester", "fieldtype": "Check", "label": "Is Tester", "insert_after": "pp_lab"},
		{
			"fieldname": "pp_min_stock",
			"fieldtype": "Float",
			"label": "Minimum Stock",
			"insert_after": "pp_is_tester",
		},
	],
	"Purchase Invoice": [
		{
			"fieldname": "pp_company_ice_on_invoice",
			"fieldtype": "Check",
			"label": "Our ICE is printed on this invoice",
			"insert_after": "bill_date",
			"allow_on_submit": 0,
		},
	],
	"User": [
		{
			"fieldname": "pp_manager_pin",
			"fieldtype": "Password",
			"label": "ParaPilot Manager PIN",
			"description": "Typed by an owner or manager to approve a cashier's return above the limit.",
			"insert_after": "username",
		},
	],
	"Journal Entry": [
		{
			"fieldname": "pp_pos_opening_entry",
			"fieldtype": "Link",
			"options": "POS Opening Entry",
			"label": "Till Session (cash taken out)",
			"read_only": 1,
			"insert_after": "voucher_type",
			"search_index": 1,
		},
	],
	"Purchase Receipt": [
		{
			"fieldname": "pp_damage_return",
			"fieldtype": "Link",
			"options": "Purchase Receipt",
			"label": "Draft Return for Damaged Goods",
			"read_only": 1,
			"no_copy": 1,
			"insert_after": "supplier_delivery_note",
		},
	],
	"POS Invoice": [
		{
			"fieldname": "pp_client_uuid",
			"fieldtype": "Data",
			"label": "Device Sale ID",
			"unique": 1,
			"read_only": 1,
			"no_copy": 1,
			"insert_after": "pos_profile",
		},
	],
	"Sales Invoice": [
		{
			"fieldname": "pp_client_uuid",
			"fieldtype": "Data",
			"label": "Device Sale ID",
			"unique": 1,
			"read_only": 1,
			"no_copy": 1,
			"insert_after": "pos_profile",
			"search_index": 1,
		},
		{
			"fieldname": "pp_price_review",
			"fieldtype": "Small Text",
			"label": "Prices to Review",
			"description": "Sold at the price shown on the till while the catalog price had changed.",
			"read_only": 1,
			"no_copy": 1,
			"insert_after": "pp_client_uuid",
		},
	],
}


# Fields ParaPilot used to add and no longer needs: removed from sites that have them.
REMOVED_CUSTOM_FIELDS = ["Supplier-pp_supplier_type"]


def before_install():
	create_roles()


def after_install():
	sync()


def after_migrate():
	sync()


def sync():
	create_roles()
	create_custom_fields(CUSTOM_FIELDS, update=True)
	for name in REMOVED_CUSTOM_FIELDS:
		if frappe.db.exists("Custom Field", name):
			frappe.delete_doc("Custom Field", name, ignore_permissions=True)
		doctype, fieldname = name.split("-", 1)
		if frappe.db.has_column(doctype, fieldname):
			# Frappe keeps the column of a deleted custom field; the data is not needed.
			frappe.db.sql_ddl(f"alter table `tab{doctype}` drop column `{fieldname}`")
	create_role_profiles()
	apply_custom_role_permissions()
	# Every selling price change is kept with who, when, old and new value.
	make_property_setter("Item Price", None, "track_changes", 1, "Check", for_doctype=True)
	# VAT is computed and rounded per line so the app and the ledger agree to the centime.
	frappe.db.set_single_value("Accounts Settings", "round_row_wise_tax", 1)
	# Item Tax Templates list sales and purchase VAT accounts together; never copy them onto documents,
	# or a sale would carry deductible VAT rows. The document's TTC template brings the right rows.
	frappe.db.set_single_value("Accounts Settings", "add_taxes_from_item_tax_template", 0)
	frappe.db.set_single_value("Accounts Settings", "add_taxes_from_taxes_and_charges_template", 1)
	# Amounts are in DH with 2 decimals: no rounding of the total to the whole dirham.
	# Saved as a document: its on_update applies the setting to every transaction type.
	global_defaults = frappe.get_single("Global Defaults")
	global_defaults.disable_rounded_total = 1
	global_defaults.save(ignore_permissions=True)
	frappe.db.commit()


def create_roles():
	for role in ROLES:
		if not frappe.db.exists("Role", role):
			frappe.get_doc(
				{"doctype": "Role", "role_name": role, "desk_access": 1 if role != CASHIER else 0}
			).insert(ignore_permissions=True)


def create_role_profiles():
	for name, roles in ROLE_PROFILES.items():
		existing = [r for r in roles if frappe.db.exists("Role", r)]
		if frappe.db.exists("Role Profile", name):
			profile = frappe.get_doc("Role Profile", name)
			profile.set("roles", [])
		else:
			profile = frappe.new_doc("Role Profile")
			profile.role_profile = name
		for role in existing:
			profile.append("roles", {"role": role})
		profile.save(ignore_permissions=True)


def apply_custom_role_permissions():
	for role, doctypes in CUSTOM_ROLE_PERMISSIONS.items():
		for doctype, ptypes in doctypes.items():
			if not frappe.db.exists("DocType", doctype):
				continue
			add_permission(doctype, role, 0)
			for ptype in ptypes:
				update_permission_property(doctype, role, 0, ptype, 1, validate=False)
