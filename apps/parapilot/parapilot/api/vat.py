"""VAT summary (spec 5.10): collected, deductible, credit carried and VAT payable for a period.

- VAT collected is read from the VAT collected accounts in the ledger, so it equals ERPNext's balances.
- Purchase VAT is deductible once the supplier invoice is paid (in part or in full): for each invoice,
  deductible-to-date = paid share x (invoice VAT + its credit notes' VAT). A period's deductible VAT is the
  change of that amount over the period, which handles part payments and late credit notes.
- VAT on cash paid to a supplier above 5,000 DH a day or 50,000 DH a month is not deductible.
"""

from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import add_days, add_months, cint, date_diff, flt, get_first_day, get_last_day, getdate, today

from parapilot.setup.chart_ma import VAT_COLLECTED, VAT_DEDUCTIBLE_GOODS, VAT_DEDUCTIBLE_OVERHEADS
from parapilot.setup.defaults import RATES
from parapilot.utils import get_settings, get_template_rate, require_app_role

VAT_ROLES = ("owner", "manager", "accountant")
MAX_PERIODS_BACK = 48


def _accounts(company: str) -> dict[str, dict[int, str]]:
	def find(name):
		return frappe.db.get_value("Account", {"company": company, "account_name": name, "is_group": 0})

	return {
		"collected": {r: find(VAT_COLLECTED.format(rate=r)) for r in RATES},
		"goods": {r: find(VAT_DEDUCTIBLE_GOODS.format(rate=r)) for r in RATES},
		"overheads": {r: find(VAT_DEDUCTIBLE_OVERHEADS.format(rate=r)) for r in RATES},
	}


def period_bounds(day, period: str) -> tuple:
	"""The monthly or quarterly declaration period containing a date."""
	day = getdate(day)
	if period == "Monthly":
		return get_first_day(day), get_last_day(day)
	first_month = 3 * ((day.month - 1) // 3) + 1
	start = day.replace(month=first_month, day=1)
	return start, get_last_day(add_months(start, 2))


def _gl_balance(accounts: list[str], start, end, credit_positive: bool) -> float:
	accounts = [a for a in accounts if a]
	if not accounts:
		return 0.0
	debit, credit = frappe.db.sql(
		"""select coalesce(sum(debit), 0), coalesce(sum(credit), 0) from `tabGL Entry`
		where account in %s and is_cancelled = 0 and posting_date between %s and %s""",
		(accounts, start, end),
	)[0]
	return flt(credit - debit if credit_positive else debit - credit, 2)


def _collected(company: str, accounts, start, end) -> list[dict]:
	"""VAT collected per rate from the ledger, with the HT base from sales lines (returns included)."""
	rows = frappe.db.sql(
		"""select item.item_tax_template, sum(item.base_net_amount)
		from `tabSales Invoice Item` item join `tabSales Invoice` inv on inv.name = item.parent
		where inv.docstatus = 1 and inv.company = %s and inv.posting_date between %s and %s
		group by item.item_tax_template""",
		(company, start, end),
	)
	base = defaultdict(float)
	for template, amount in rows:
		base[flt(get_template_rate(template))] += flt(amount)
	result = []
	for rate in sorted(set(base) | set(RATES), reverse=True):
		vat = _gl_balance([accounts["collected"].get(rate)], start, end, credit_positive=True) if rate else 0.0
		if vat or base.get(rate):
			result.append({"rate": rate, "ht": flt(base.get(rate, 0), 2), "vat": vat})
	return result


def _invoice_vat(invoice, accounts) -> dict[str, float]:
	goods = set(accounts["goods"].values())
	overheads = set(accounts["overheads"].values())
	vat = {"goods": 0.0, "overheads": 0.0}
	for t in invoice.taxes:
		amount = flt(t.base_tax_amount_after_discount_amount)
		if t.add_deduct_tax == "Deduct":
			amount = -amount
		if t.account_head in goods:
			vat["goods"] += amount
		elif t.account_head in overheads:
			vat["overheads"] += amount
	return vat


def _deductible_to(day, invoices: list[dict]) -> dict[str, float]:
	"""Deductible VAT accumulated up to a date over the given purchase invoices."""
	total = {"goods": 0.0, "overheads": 0.0}
	for inv in invoices:
		if getdate(inv["posting_date"]) > getdate(day):
			continue
		notes = [n for n in inv["notes"] if getdate(n["posting_date"]) <= getdate(day)]
		payable = inv["grand_total"] + sum(n["grand_total"] for n in notes)
		paid = sum(p["amount"] for p in inv["payments"] if getdate(p["posting_date"]) <= getdate(day))
		if payable <= 0 or paid <= 0:
			continue
		share = min(paid / payable, 1)
		for kind in total:
			total[kind] += share * (inv["vat"][kind] + sum(n["vat"][kind] for n in notes))
	return {k: flt(v, 2) for k, v in total.items()}


def _purchase_invoices(company: str, accounts, until) -> list[dict]:
	names = frappe.get_all(
		"Purchase Invoice",
		filters={"company": company, "docstatus": 1, "is_return": 0, "posting_date": ["<=", until]},
		pluck="name",
	)
	invoices = []
	for name in names:
		doc = frappe.get_doc("Purchase Invoice", name)
		vat = _invoice_vat(doc, accounts)
		if not any(vat.values()):
			continue
		notes = [
			{"posting_date": n.posting_date, "grand_total": flt(n.base_grand_total), "vat": _invoice_vat(n, accounts)}
			for n in (
				frappe.get_doc("Purchase Invoice", x)
				for x in frappe.get_all(
					"Purchase Invoice", filters={"return_against": name, "docstatus": 1, "is_return": 1}, pluck="name"
				)
			)
		]
		payments = frappe.db.sql(
			"""select pe.posting_date, ref.allocated_amount as amount
			from `tabPayment Entry Reference` ref join `tabPayment Entry` pe on pe.name = ref.parent
			where ref.reference_doctype = 'Purchase Invoice' and ref.reference_name = %s and pe.docstatus = 1""",
			name,
			as_dict=True,
		)
		invoices.append(
			{
				"name": name,
				"supplier": doc.supplier_name,
				"bill_no": doc.bill_no,
				"posting_date": doc.posting_date,
				"grand_total": flt(doc.base_grand_total),
				"outstanding": flt(doc.outstanding_amount),
				"ice_on_invoice": doc.pp_company_ice_on_invoice,
				"vat": vat,
				"notes": notes,
				"payments": [{"posting_date": p.posting_date, "amount": flt(p.amount)} for p in payments],
			}
		)
	return invoices


def _cash_over_limits(company: str, start, end, invoices: list[dict]) -> list[dict]:
	"""Cash paid to a supplier above the daily or monthly limit, with the VAT that is not deductible."""
	settings = get_settings()
	daily_limit = flt(settings.cash_deduction_daily_limit) or 5000
	monthly_limit = flt(settings.cash_deduction_monthly_limit) or 50000
	rows = frappe.db.sql(
		"""select pe.party, pe.party_name, pe.posting_date, pe.paid_amount, pe.name
		from `tabPayment Entry` pe join `tabMode of Payment` mop on mop.name = pe.mode_of_payment
		where pe.docstatus = 1 and pe.payment_type = 'Pay' and pe.party_type = 'Supplier' and mop.type = 'Cash'
		and pe.company = %s and pe.posting_date between %s and %s order by pe.posting_date, pe.creation""",
		(company, get_first_day(start), end),
		as_dict=True,
	)
	vat_share = {}
	for inv in invoices:
		vat_share[inv["name"]] = (sum(inv["vat"].values()) / inv["grand_total"]) if inv["grand_total"] else 0
	day_total, month_total = defaultdict(float), defaultdict(float)
	result = []
	for r in rows:
		day_key = (r.party, r.posting_date)
		month_key = (r.party, r.posting_date.year, r.posting_date.month)
		day_total[day_key] += flt(r.paid_amount)
		month_total[month_key] += flt(r.paid_amount)
		over = min(flt(r.paid_amount), max(day_total[day_key] - daily_limit, month_total[month_key] - monthly_limit, 0))
		if over <= 0 or getdate(r.posting_date) < getdate(start):
			continue
		refs = frappe.get_all(
			"Payment Entry Reference", filters={"parent": r.name, "reference_doctype": "Purchase Invoice"}, pluck="reference_name"
		)
		share = vat_share.get(refs[0], 0.2 / 1.2) if refs else 0.2 / 1.2
		result.append(
			{"supplier": r.party_name, "date": str(r.posting_date), "payment": r.name, "over": flt(over, 2), "vat_lost": flt(over * share, 2)}
		)
	return result


def _summary(company: str, start, end, accounts, invoices, credit_in: float) -> dict:
	collected = _collected(company, accounts, start, end)
	before = _deductible_to(add_days(start, -1), invoices)
	after = _deductible_to(end, invoices)
	deductible = {k: flt(after[k] - before[k], 2) for k in after}
	cash = _cash_over_limits(company, start, end, invoices)
	vat_lost = flt(sum(c["vat_lost"] for c in cash), 2)
	collected_total = flt(sum(c["vat"] for c in collected), 2)
	net = flt(collected_total - deductible["goods"] - deductible["overheads"] + vat_lost - credit_in, 2)
	return {
		"collected": collected,
		"collected_total": collected_total,
		"deductible_goods": deductible["goods"],
		"deductible_overheads": deductible["overheads"],
		"cash_vat_lost": vat_lost,
		"cash_over_limits": cash,
		"credit_in": flt(credit_in, 2),
		"payable": max(net, 0),
		"credit_out": max(-net, 0),
	}


def _first_activity(company: str):
	dates = [
		frappe.db.get_value(dt, {"company": company, "docstatus": 1}, "posting_date", order_by="posting_date asc")
		for dt in ("Sales Invoice", "Purchase Invoice")
	]
	dates = [d for d in dates if d]
	return min(dates) if dates else getdate(today())


@frappe.whitelist()
def periods() -> list[dict]:
	"""Declaration periods from the first transaction to now, most recent first."""
	require_app_role(*VAT_ROLES)
	settings = get_settings()
	start, _end = period_bounds(_first_activity(settings.company), settings.vat_period or "Quarterly")
	result = []
	while getdate(start) <= getdate(today()) and len(result) < MAX_PERIODS_BACK:
		s, e = period_bounds(start, settings.vat_period or "Quarterly")
		result.append({"start": str(s), "end": str(e)})
		start = add_days(e, 1)
	return list(reversed(result))


@frappe.whitelist()
def summary(start: str | None = None) -> dict:
	"""VAT summary of the period starting at `start` (default: the current period)."""
	require_app_role(*VAT_ROLES)
	settings = get_settings()
	company = settings.company
	kind = settings.vat_period or "Quarterly"
	start, end = period_bounds(start or today(), kind)
	accounts = _accounts(company)
	invoices = _purchase_invoices(company, accounts, end)

	# Credit carried: replay every period since the first transaction.
	credit = 0.0
	cursor, _e = period_bounds(_first_activity(company), kind)
	while getdate(cursor) < getdate(start):
		s, e = period_bounds(cursor, kind)
		credit = _summary(company, s, e, accounts, invoices, credit)["credit_out"]
		cursor = add_days(e, 1)
	result = _summary(company, start, end, accounts, invoices, credit)

	deadline = add_days(add_months(get_first_day(end), 1), cint(settings.vat_deadline_day or 20) - 1)
	has_activity = bool(result["collected"]) or any(
		inv for inv in invoices if getdate(start) <= getdate(inv["posting_date"]) <= getdate(end)
	)
	recorded_deductible = _gl_balance(
		list(accounts["goods"].values()) + list(accounts["overheads"].values()), start, end, credit_positive=False
	)
	result.update(
		{
			"period": {"start": str(start), "end": str(end), "kind": kind},
			"basis": settings.vat_basis or "Cash",
			"deadline": str(deadline),
			"days_to_deadline": date_diff(deadline, today()),
			"zero_declaration": not has_activity,
			# Reconciliation with the ledger: purchase VAT is booked at invoice, deducted once paid.
			"ledger": {
				"collected": _gl_balance(list(accounts["collected"].values()), start, end, credit_positive=True),
				"deductible_recorded": recorded_deductible,
			},
			"checks": _checks(company, start, end, invoices, result["cash_over_limits"]),
		}
	)
	return result


def _checks(company: str, start, end, invoices: list[dict], cash: list[dict]) -> dict:
	"""What to fix before the period is declared (spec 5.10)."""
	no_vat = frappe.db.sql(
		"""select distinct item.item_code, item.item_name from `tabSales Invoice Item` item
		join `tabSales Invoice` inv on inv.name = item.parent
		where inv.docstatus = 1 and inv.company = %s and inv.posting_date between %s and %s
		and (item.item_tax_template is null or item.item_tax_template = '')
		and inv.total_taxes_and_charges = 0""",
		(company, start, end),
		as_dict=True,
	)
	in_period = [i for i in invoices if getdate(start) <= getdate(i["posting_date"]) <= getdate(end)]
	unpaid = []
	for inv in invoices:
		if inv["outstanding"] <= 0:
			continue
		payable = inv["grand_total"] + sum(n["grand_total"] for n in inv["notes"])
		share = inv["outstanding"] / payable if payable else 0
		unpaid.append(
			{
				"name": inv["name"],
				"supplier": inv["supplier"],
				"bill_no": inv["bill_no"],
				"outstanding": flt(inv["outstanding"], 2),
				"vat_waiting": flt(share * (sum(inv["vat"].values()) + sum(sum(n["vat"].values()) for n in inv["notes"])), 2),
			}
		)
	return {
		"items_without_vat": no_vat,
		"invoices_without_ice": [
			{"name": i["name"], "supplier": i["supplier"], "bill_no": i["bill_no"]} for i in in_period if not i["ice_on_invoice"]
		],
		"cash_over_limits": cash,
		"unpaid_invoices": unpaid,
	}


@frappe.whitelist()
def export(start: str | None = None):
	"""The summary and its detail as an Excel file for the accountant."""
	from frappe.utils.xlsxutils import make_xlsx

	data = summary(start)
	p = data["period"]
	rows = [
		[_("VAT summary"), f"{p['start']} → {p['end']}"],
		[],
		[_("VAT collected"), _("Rate"), _("Base excl. VAT"), _("VAT")],
		*[["", f"{c['rate']}%", c["ht"], c["vat"]] for c in data["collected"]],
		[_("Total VAT collected"), "", "", data["collected_total"]],
		[],
		[_("Deductible VAT on goods (paid invoices)"), "", "", data["deductible_goods"]],
		[_("Deductible VAT on overheads (paid invoices)"), "", "", data["deductible_overheads"]],
		[_("VAT not deductible (cash above limits)"), "", "", data["cash_vat_lost"]],
		[_("VAT credit from previous period"), "", "", data["credit_in"]],
		[_("VAT payable"), "", "", data["payable"]],
		[_("VAT credit to carry"), "", "", data["credit_out"]],
		[_("Deadline"), data["deadline"]],
		[],
		[_("Unpaid supplier invoices (VAT not yet deductible)"), _("Supplier"), _("Owed"), _("VAT waiting")],
		*[[u["bill_no"] or u["name"], u["supplier"], u["outstanding"], u["vat_waiting"]] for u in data["checks"]["unpaid_invoices"]],
	]
	xlsx = make_xlsx(rows, "TVA")
	frappe.response["filename"] = f"TVA_{p['start']}_{p['end']}.xlsx"
	frappe.response["filecontent"] = xlsx.getvalue()
	frappe.response["type"] = "binary"
