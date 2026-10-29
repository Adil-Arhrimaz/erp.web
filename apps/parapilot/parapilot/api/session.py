import frappe
from frappe import _

from parapilot.utils import get_app_roles, get_settings

THEMES = {"Light": "light", "Dark": "dark", "Automatic": "system"}
LANGUAGES = {"fr", "en"}


@frappe.whitelist()
def get_context() -> dict:
	"""Everything the web app needs after login: who the user is, their preferences, the shop."""
	user = frappe.get_cached_doc("User", frappe.session.user)
	settings = get_settings()
	company = None
	if settings.company:
		c = frappe.get_cached_doc("Company", settings.company)
		company = {
			"name": c.name,
			"abbr": c.abbr,
			"currency": c.default_currency,
			"ice": c.get("pp_ice"),
			"if": c.get("pp_if"),
			"rc": c.get("pp_rc"),
			"tp": c.get("pp_tp"),
		}
	language = (user.language or "fr")[:2]
	return {
		"user": user.name,
		"full_name": user.full_name,
		"image": user.user_image,
		"language": language if language in LANGUAGES else "fr",
		"theme": THEMES.get(user.desk_theme or "Automatic", "system"),
		"roles": get_app_roles(),
		"company": company,
		"setup_complete": bool(settings.company),
		"settings": {
			"cashier_discount_limit": settings.cashier_discount_limit,
			"return_pin_threshold": settings.return_pin_threshold,
			"expiry_warning_days": settings.expiry_warning_days,
			"receipt_language": settings.receipt_language,
			"vat_period": settings.vat_period,
		},
	}


@frappe.whitelist(methods=["POST"])
def set_preferences(language: str | None = None, theme: str | None = None) -> dict:
	"""Language and theme follow the user, so a shared till follows whoever is logged in."""
	values = {}
	if language is not None:
		if language not in LANGUAGES:
			frappe.throw(_("Unsupported language."))
		values["language"] = language
	if theme is not None:
		desk_theme = {v: k for k, v in THEMES.items()}.get(theme)
		if not desk_theme:
			frappe.throw(_("Unsupported theme."))
		values["desk_theme"] = desk_theme
	if values:
		# Only ever the caller's own record.
		frappe.db.set_value("User", frappe.session.user, values)
		frappe.clear_cache(user=frappe.session.user)
	return values
