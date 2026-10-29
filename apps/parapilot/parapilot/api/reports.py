"""Reports (spec 5.9): the shop's questions, answered from ERPNext documents.

Every report filters by period, item group (family) and brand; stock reports also by location. Margins
use the cost of each sold line at the time of sale (ERPNext's incoming rate), on HT amounts.
"""

import json
from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import add_days, add_months, add_years, cint, date_diff, flt, get_first_day, get_last_day, getdate, today

from parapilot.utils import can_see_costs, get_settings, require_app_role

REPORT_ROLES = ("owner", "manager", "accountant")
COST_REPORTS = {"margins", "stock_value"}


def _filters(raw) -> frappe._dict:
	f = frappe._dict(json.loads(raw) if isinstance(raw, str) else (raw or {}))
	f.from_date = getdate(f.from_date or get_first_day(today()))
	f.to_date = getdate(f.to_date or today())
	return f


def _sales_lines(f, company: str) -> list[dict]:
	"""Submitted sale and return lines in the period, with cost (returns are negative)."""
	conditions = ["inv.docstatus = 1", "inv.company = %(company)s", "inv.posting_date between %(from)s and %(to)s"]
	if f.item_group:
		lft, rgt = frappe.db.get_value("Item Group", f.item_group, ["lft", "rgt"])
		conditions.append(f"item.item_group in (select name from `tabItem Group` where lft >= {cint(lft)} and rgt <= {cint(rgt)})")
	if f.brand:
		conditions.append("item.brand = %(brand)s")
	return frappe.db.sql(
		f"""select inv.name as invoice, inv.posting_date, inv.is_return, item.item_code, item.item_name,
			item.brand, item.item_group, item.stock_qty as qty, item.base_net_amount as ht,
			item.base_amount as ttc, item.incoming_rate, item.discount_amount, item.qty as line_qty
		from `tabSales Invoice Item` item join `tabSales Invoice` inv on inv.name = item.parent
		where {" and ".join(conditions)}""",
		{"company": company, "from": f.from_date, "to": f.to_date, "brand": f.brand},
		as_dict=True,
	)


def _margin(line) -> float:
	return flt(line.ht) - flt(line.incoming_rate) * flt(line.qty)


@frappe.whitelist()
def run(report: str, filters: str | dict | None = None) -> dict:
	require_app_role(*REPORT_ROLES)
	if report in COST_REPORTS and not can_see_costs():
		frappe.throw(_("You cannot see costs."), frappe.PermissionError)
	f = _filters(filters)
	handler = REPORTS.get(report)
	if not handler:
		frappe.throw(_("Unknown report."))
	result = handler(f, get_settings().company)
	result["filters"] = {k: str(v) if v else v for k, v in f.items()}
	return result


def daily_summary(f, company):
	"""How did today go? Sales TTC/HT, VAT, tickets, average basket, by payment method."""
	f.from_date = f.to_date
	invoices = frappe.get_all(
		"Sales Invoice",
		filters={"docstatus": 1, "company": company, "posting_date": f.to_date},
		fields=["name", "is_return", "base_grand_total", "base_net_total", "base_total_taxes_and_charges"],
	)
	sales = [i for i in invoices if not i.is_return]
	returns = [i for i in invoices if i.is_return]
	payments = defaultdict(float)
	for p in frappe.get_all(
		"Sales Invoice Payment",
		filters={"parent": ["in", [i.name for i in invoices] or [""]]},
		fields=["mode_of_payment", "base_amount"],
	):
		payments[p.mode_of_payment] += flt(p.base_amount)
	change = sum(
		flt(c)
		for c in frappe.get_all(
			"Sales Invoice", filters={"name": ["in", [i.name for i in sales] or [""]]}, pluck="base_change_amount"
		)
	)
	cash_mode = frappe.db.get_value("Mode of Payment", {"type": "Cash"}, "name")
	if cash_mode in payments:
		payments[cash_mode] -= change
	ttc = sum(flt(i.base_grand_total) for i in invoices)
	return {
		"kpis": {
			"ttc": flt(ttc, 2),
			"ht": flt(sum(flt(i.base_net_total) for i in invoices), 2),
			"vat": flt(sum(flt(i.base_total_taxes_and_charges) for i in invoices), 2),
			"tickets": len(sales),
			"average_basket": flt(sum(flt(i.base_grand_total) for i in sales) / len(sales), 2) if sales else 0,
			"returns": flt(sum(flt(i.base_grand_total) for i in returns), 2),
		},
		"rows": [{"mode_of_payment": m, "amount": flt(a, 2)} for m, a in sorted(payments.items())],
		"columns": ["mode_of_payment", "amount"],
	}


def _totals(lines):
	return {
		"ttc": flt(sum(flt(l.ttc) for l in lines), 2),
		"ht": flt(sum(flt(l.ht) for l in lines), 2),
		"tickets": len({l.invoice for l in lines if not l.is_return}),
	}


def monthly_sales(f, company):
	"""This month by day, family and brand, against last month and the same month last year."""
	start = get_first_day(f.to_date)
	end = get_last_day(f.to_date)
	f.from_date, f.to_date = start, end
	lines = _sales_lines(f, company)

	def period_total(s, e):
		g = frappe._dict(f, from_date=s, to_date=e)
		return _totals(_sales_lines(g, company))

	by_day = defaultdict(float)
	for l in lines:
		by_day[str(l.posting_date)] += flt(l.ttc)
	days = []
	day = start
	while day <= end:
		days.append({"date": str(day), "ttc": flt(by_day.get(str(day), 0), 2)})
		day = add_days(day, 1)
	by_group, by_brand = defaultdict(float), defaultdict(float)
	for l in lines:
		by_group[l.item_group] += flt(l.ttc)
		by_brand[l.brand or "—"] += flt(l.ttc)
	current = _totals(lines)
	previous = period_total(get_first_day(add_months(start, -1)), get_last_day(add_months(start, -1)))
	last_year = period_total(add_years(start, -1), get_last_day(add_years(start, -1)))

	def change(now, before):
		return flt((now - before) / before, 4) if before else None

	return {
		"kpis": {
			**current,
			"previous_ttc": previous["ttc"],
			"vs_previous": change(current["ttc"], previous["ttc"]),
			"last_year_ttc": last_year["ttc"],
			"vs_last_year": change(current["ttc"], last_year["ttc"]),
		},
		"series": days,
		"rows": [{"item_group": g, "ttc": flt(v, 2)} for g, v in sorted(by_group.items(), key=lambda x: -x[1])],
		"brands": [{"brand": b, "ttc": flt(v, 2)} for b, v in sorted(by_brand.items(), key=lambda x: -x[1])],
		"columns": ["item_group", "ttc"],
	}


def best_sellers(f, company):
	"""Top 20 by quantity, by sales HT and (for those who see costs) by margin."""
	per_item = {}
	for l in _sales_lines(f, company):
		row = per_item.setdefault(l.item_code, {"item_code": l.item_code, "item_name": l.item_name, "brand": l.brand, "qty": 0.0, "ht": 0.0, "margin": 0.0})
		row["qty"] += flt(l.qty)
		row["ht"] += flt(l.ht)
		row["margin"] += _margin(l)
	rows = [{**r, "qty": flt(r["qty"]), "ht": flt(r["ht"], 2), "margin": flt(r["margin"], 2)} for r in per_item.values()]
	sort_by = f.sort_by if f.sort_by in ("qty", "ht", "margin") else "qty"
	if sort_by == "margin" and not can_see_costs():
		sort_by = "ht"
	rows.sort(key=lambda r: -r[sort_by])
	columns = ["item_name", "brand", "qty", "ht"] + (["margin"] if can_see_costs() else [])
	if not can_see_costs():
		for r in rows:
			r.pop("margin")
	return {"rows": rows[:20], "columns": columns, "sort_by": sort_by}


def slow_movers(f, company):
	"""What is sleeping on the shelf: in stock, no sale for 60 or 90 days, with value at cost."""
	days = cint(f.days) or 60
	since = add_days(today(), -days)
	settings = get_settings()
	warehouses = [w for w in (settings.shop_floor_warehouse, settings.back_store_warehouse) if w]
	stock = frappe.db.sql(
		"""select bin.item_code, item.item_name, item.brand, item.item_group,
			sum(bin.actual_qty) as qty, sum(bin.stock_value) as value
		from `tabBin` bin join `tabItem` item on item.name = bin.item_code
		where bin.warehouse in %s and bin.actual_qty > 0 group by bin.item_code""",
		[warehouses],
		as_dict=True,
	)
	last_sale = dict(
		frappe.db.sql(
			"""select item.item_code, max(inv.posting_date) from `tabSales Invoice Item` item
			join `tabSales Invoice` inv on inv.name = item.parent
			where inv.docstatus = 1 and inv.is_return = 0 and inv.company = %s group by item.item_code""",
			company,
		)
	)
	rows = []
	for s in stock:
		if f.item_group and s.item_group != f.item_group or f.brand and s.brand != f.brand:
			continue
		last = last_sale.get(s.item_code)
		if last and getdate(last) >= getdate(since):
			continue
		row = {
			"item_name": s.item_name,
			"brand": s.brand,
			"qty": flt(s.qty),
			"last_sale": str(last) if last else None,
			"idle_days": date_diff(today(), last) if last else None,
		}
		if can_see_costs():
			row["value"] = flt(s.value, 2)
		rows.append(row)
	rows.sort(key=lambda r: -(r.get("value") or r["qty"]))
	return {
		"rows": rows,
		"columns": ["item_name", "brand", "qty", "last_sale"] + (["value"] if can_see_costs() else []),
		"kpis": {"items": len(rows), "value": flt(sum(r.get("value", 0) for r in rows), 2) if can_see_costs() else None},
	}


def stock_value(f, company):
	"""How much money is in stock: value at cost HT by location, family and brand."""
	settings = get_settings()
	roles = {
		settings.shop_floor_warehouse: "shop_floor",
		settings.back_store_warehouse: "back_store",
		settings.quarantine_warehouse: "quarantine",
	}
	data = frappe.db.sql(
		"""select bin.warehouse, item.item_group, item.brand, sum(bin.stock_value) as value, sum(bin.actual_qty) as qty
		from `tabBin` bin join `tabItem` item on item.name = bin.item_code
		where bin.warehouse in %s group by bin.warehouse, item.item_group, item.brand""",
		[[w for w in roles if w]],
		as_dict=True,
	)
	by_location, by_group, by_brand = defaultdict(float), defaultdict(float), defaultdict(float)
	for d in data:
		if f.item_group and d.item_group != f.item_group or f.brand and d.brand != f.brand:
			continue
		by_location[roles[d.warehouse]] += flt(d.value)
		by_group[d.item_group] += flt(d.value)
		by_brand[d.brand or "—"] += flt(d.value)
	return {
		"kpis": {"value": flt(sum(by_location.values()), 2)},
		"locations": [{"location": k, "value": flt(v, 2)} for k, v in by_location.items()],
		"rows": [{"item_group": k, "value": flt(v, 2)} for k, v in sorted(by_group.items(), key=lambda x: -x[1])],
		"brands": [{"brand": k, "value": flt(v, 2)} for k, v in sorted(by_brand.items(), key=lambda x: -x[1])],
		"columns": ["item_group", "value"],
	}


def purchases_by_supplier(f, company):
	"""Who do I buy from? Amount HT and VAT by supplier (credit notes deducted)."""
	rows = frappe.db.sql(
		"""select supplier_name, sum(base_net_total) as ht, sum(base_total_taxes_and_charges) as vat,
			sum(base_grand_total) as ttc, count(*) as invoices
		from `tabPurchase Invoice` where docstatus = 1 and company = %s and posting_date between %s and %s
		group by supplier order by ht desc""",
		(company, f.from_date, f.to_date),
		as_dict=True,
	)
	return {
		"rows": [{**r, "ht": flt(r.ht, 2), "vat": flt(r.vat, 2), "ttc": flt(r.ttc, 2)} for r in rows],
		"columns": ["supplier_name", "invoices", "ht", "vat", "ttc"],
		"kpis": {"ht": flt(sum(flt(r.ht) for r in rows), 2), "vat": flt(sum(flt(r.vat) for r in rows), 2)},
	}


def margins(f, company):
	"""Where do I make money? Margin in DH and margin rate by product, brand or family."""
	dimension = f.group_by if f.group_by in ("item_name", "brand", "item_group") else "item_group"
	groups = {}
	for l in _sales_lines(f, company):
		key = l.get(dimension) or "—"
		row = groups.setdefault(key, {dimension: key, "ht": 0.0, "cost": 0.0})
		row["ht"] += flt(l.ht)
		row["cost"] += flt(l.incoming_rate) * flt(l.qty)
	rows = []
	for r in groups.values():
		margin = r["ht"] - r["cost"]
		rows.append(
			{
				**r,
				"ht": flt(r["ht"], 2),
				"cost": flt(r["cost"], 2),
				"margin": flt(margin, 2),
				"margin_rate": flt(margin / r["ht"], 4) if r["ht"] else None,
			}
		)
	rows.sort(key=lambda r: -r["margin"])
	total_ht = sum(r["ht"] for r in rows)
	total_margin = sum(r["margin"] for r in rows)
	return {
		"rows": rows,
		"columns": [dimension, "ht", "cost", "margin", "margin_rate"],
		"group_by": dimension,
		"kpis": {"ht": flt(total_ht, 2), "margin": flt(total_margin, 2), "margin_rate": flt(total_margin / total_ht, 4) if total_ht else None},
	}


def expiry(f, company):
	"""What must I sell or return soon? Batches by expiry window, value at cost."""
	from parapilot.api.stock import expiry_board

	board = expiry_board(cint(f.days) or 90)
	return {"rows": board["batches"], "columns": ["item_name", "lot", "expiry_date", "qty"] + (["value"] if board["show_costs"] else []), "kpis": board["totals"]}


REPORTS = {
	"daily_summary": daily_summary,
	"monthly_sales": monthly_sales,
	"best_sellers": best_sellers,
	"slow_movers": slow_movers,
	"expiry": expiry,
	"stock_value": stock_value,
	"purchases_by_supplier": purchases_by_supplier,
	"margins": margins,
}


@frappe.whitelist()
def export(report: str, filters: str | dict | None = None):
	"""The report's table as an Excel file."""
	from frappe.utils.xlsxutils import make_xlsx

	data = run(report, filters)
	columns = data["columns"]
	rows = [columns] + [[r.get(c) for c in columns] for r in data["rows"]]
	frappe.response["filename"] = f"{report}_{data['filters']['from_date']}_{data['filters']['to_date']}.xlsx"
	frappe.response["filecontent"] = make_xlsx(rows, report[:31]).getvalue()
	frappe.response["type"] = "binary"
