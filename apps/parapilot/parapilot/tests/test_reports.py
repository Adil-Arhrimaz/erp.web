import frappe
from frappe.utils import flt, today

from parapilot.api import reports
from parapilot.tests.utils import TillTestCase

CREAM = "6111000000014"


class TestReports(TillTestCase):
	def setUp(self):
		super().setUp()
		self.sale(
			"TESTREP000001",
			[{"item_code": self.item_by_barcode(CREAM), "qty": 2, "price": 189, "rate": 189}],
			[{"mode_of_payment": "Espèces", "amount": 378}],
		)
		frappe.set_user("owner@dev.local")

	def test_every_report_runs(self):
		for name in reports.REPORTS:
			result = reports.run(name, {"from_date": today(), "to_date": today()})
			self.assertIn("rows", result, name)

	def test_margin_is_sales_ht_minus_cost(self):
		data = reports.run("margins", {"from_date": today(), "to_date": today(), "group_by": "item_name"})
		cream = next(r for r in data["rows"] if r["item_name"] == "Crème hydratante 50 ml")
		self.assertGreater(cream["ht"], 0)
		self.assertEqual(cream["margin"], flt(cream["ht"] - cream["cost"], 2))

	def test_daily_summary_counts_the_sale(self):
		data = reports.run("daily_summary", {"to_date": today()})
		self.assertGreaterEqual(data["kpis"]["tickets"], 1)
		self.assertGreaterEqual(data["kpis"]["ttc"], 378)

	def test_stock_clerk_cannot_see_cost_reports(self):
		self.as_user("stock@dev.local")
		with self.assertRaises(frappe.PermissionError):
			reports.run("margins", {})
