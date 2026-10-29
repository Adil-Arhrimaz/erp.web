import frappe
from frappe import _

from parapilot.setup.install import ACCOUNTANT, AI, CASHIER, MANAGER, OWNER, STOCK_CLERK

# Highest first: a user holding several ParaPilot roles is shown the screens of the highest one.
ROLE_PRIORITY = [
	(OWNER, "owner"),
	(MANAGER, "manager"),
	(ACCOUNTANT, "accountant"),
	(STOCK_CLERK, "stock_clerk"),
	(CASHIER, "cashier"),
	(AI, "ai"),
]


def get_app_roles(user: str | None = None) -> list[str]:
	user = user or frappe.session.user
	if user == "Administrator":
		return ["owner"]
	roles = set(frappe.get_roles(user))
	if "System Manager" in roles and OWNER not in roles:
		roles.add(OWNER)
	return [key for role, key in ROLE_PRIORITY if role in roles]


def can_see_costs(user: str | None = None) -> bool:
	return bool({"owner", "manager", "accountant"} & set(get_app_roles(user)))


def require_app_role(*allowed: str):
	if not set(allowed) & set(get_app_roles()):
		frappe.throw(_("You do not have access to this screen."), frappe.PermissionError)


def get_settings():
	return frappe.get_cached_doc("ParaPilot Settings")


@frappe.request_cache
def get_template_rate(item_tax_template: str | None) -> float | None:
	"""VAT rate of an Item Tax Template: the highest rate among its rows (0 for exempt)."""
	if not item_tax_template:
		return None
	rates = frappe.get_all(
		"Item Tax Template Detail", filters={"parent": item_tax_template}, pluck="tax_rate"
	)
	return max(rates) if rates else 0.0
