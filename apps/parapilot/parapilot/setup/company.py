"""Setup wizard step 1: create the company on the ParaPilot CGNC chart."""

import frappe
from frappe.utils import getdate

from parapilot.setup.chart_ma import CHART

# Default accounts ERPNext needs, by account number in chart_ma.CHART.
DEFAULT_ACCOUNTS = {
	"default_receivable_account": "3421",
	"default_payable_account": "4411",
	"default_cash_account": "5161",
	"default_bank_account": "5141",
	"default_income_account": "7111",
	"default_expense_account": "6111",
	"default_discount_account": "7119",
	"default_inventory_account": "3111",
	"stock_adjustment_account": "6114",
	"stock_received_but_not_billed": "4417",
	"expenses_included_in_valuation": "6141",
	"round_off_account": "6588",
	"write_off_account": "61858",
	"exchange_gain_loss_account": "6331",
	"accumulated_depreciation_account": "2835",
	"depreciation_expense_account": "6193",
	"capital_work_in_progress_account": "2392",
	"disposal_account": "6513",
}


def account_by_number(company: str, number: str) -> str | None:
	return frappe.db.get_value("Account", {"company": company, "account_number": number, "is_group": 0})


def ensure_erpnext_fixtures(country: str = "Morocco"):
	"""ERPNext v16 can mark setup complete without installing its base records (territories, UOMs,
	item group root, warehouse types). Install them once, in English, so record names are stable."""
	if frappe.db.exists("Warehouse Type", "Transit"):
		return
	from erpnext.setup.setup_wizard.operations.install_fixtures import install

	lang = frappe.local.lang
	frappe.local.lang = "en"
	try:
		install(country)
	finally:
		frappe.local.lang = lang


def create_company(
	company_name: str,
	abbr: str,
	legal_ids: dict | None = None,
	fy_start_date: str | None = None,
	fy_end_date: str | None = None,
) -> str:
	from erpnext.accounts.doctype.account.chart_of_accounts.chart_of_accounts import create_charts
	from erpnext.setup.setup_wizard.operations.install_fixtures import install_defaults

	ensure_erpnext_fixtures()

	year = getdate().year
	fy_start_date = fy_start_date or f"{year}-01-01"
	fy_end_date = fy_end_date or f"{year}-12-31"

	if not frappe.db.exists("Fiscal Year", {"year_start_date": fy_start_date}):
		frappe.get_doc(
			{
				"doctype": "Fiscal Year",
				"year": str(getdate(fy_start_date).year)
				if getdate(fy_start_date).year == getdate(fy_end_date).year
				else f"{getdate(fy_start_date).year}-{getdate(fy_end_date).year}",
				"year_start_date": fy_start_date,
				"year_end_date": fy_end_date,
			}
		).insert(ignore_permissions=True)

	# The chart is ours: skip ERPNext's template chart and its generic "VAT 20%" tax setup.
	frappe.local.flags.ignore_chart_of_accounts = True
	try:
		company = frappe.get_doc(
			{
				"doctype": "Company",
				"company_name": company_name,
				"abbr": abbr,
				"default_currency": "MAD",
				"country": "Morocco",
				"enable_perpetual_inventory": 1,
				"create_chart_of_accounts_based_on": "Standard Template",
				"chart_of_accounts": "Standard",
				**(legal_ids or {}),
			}
		).insert(ignore_permissions=True)
	finally:
		frappe.local.flags.ignore_chart_of_accounts = False

	frappe.local.flags.ignore_root_company_validation = True
	create_charts(company.name, custom_chart=CHART)
	company.reload()
	for field, number in DEFAULT_ACCOUNTS.items():
		if company.meta.has_field(field):
			company.set(field, account_by_number(company.name, number))
	company.round_off_cost_center = company.cost_center
	company.create_default_warehouses()
	company.save(ignore_permissions=True)

	install_defaults(
		frappe._dict({"company_name": company.name, "currency": "MAD", "country": "Morocco"})
	)
	return company.name
