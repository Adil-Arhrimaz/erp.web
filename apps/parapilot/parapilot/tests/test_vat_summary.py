import frappe
from frappe.utils import flt

from parapilot.api import purchasing, returns, vat
from parapilot.tests.utils import ParaPilotTestCase

CREAM = "6111000000014"


class TestVatSummary(ParaPilotTestCase):
	"""Past quarters of 2026 with no other activity, so the figures are exact."""

	def setUp(self):
		super().setUp()
		frappe.db.set_single_value("ParaPilot Settings", "vat_period", "Quarterly")
		frappe.clear_document_cache("ParaPilot Settings", "ParaPilot Settings")
		self.supplier = purchasing.save_supplier({"supplier_name": "_Test TVA", "pp_ice": "002345678000077"})["name"]
		self.overhead = frappe.db.get_value("Item", {"item_name": "Électricité"}, "name")

	def sale(self, day, rate=189):
		si = frappe.get_doc(
			{
				"doctype": "Sales Invoice",
				"company": self.company,
				"customer": "Client comptoir",
				"posting_date": day,
				"set_posting_time": 1,
				"taxes_and_charges": self.settings.sales_taxes_template,
				"disable_rounded_total": 1,
				"items": [{"item_code": self.item_by_barcode(CREAM), "qty": 1, "rate": rate}],
			}
		).insert()
		si.submit()
		return si

	def purchase(self, day, amount, bill_no, qty=1):
		pi = purchasing.save_invoice(
			{
				"supplier": self.supplier,
				"bill_no": bill_no,
				"posting_date": day,
				"bill_date": day,
				"lines": [{"item_code": self.overhead, "qty": qty, "rate": amount / qty}],
				"pp_company_ice_on_invoice": 1,
			}
		)
		return purchasing.submit_invoice(pi["name"])

	def test_deductible_only_when_paid_and_credit_carried(self):
		self.sale("2026-02-10")  # 189 TTC = 31.50 VAT collected
		pi = self.purchase("2026-02-01", 1200, "FA-Q1", qty=10)  # 10 × 120 TTC: 200 VAT, not yet paid
		purchasing.pay_invoice(pi["name"], 600, "Virement bancaire", "2026-03-05", "VIR-1")

		q1 = vat.summary("2026-01-01")
		self.assertEqual(q1["collected_total"], 31.5)
		self.assertEqual(q1["ledger"]["collected"], 31.5, "summary and ledger agree to the centime")
		self.assertEqual(q1["deductible_overheads"], 100)  # half paid
		self.assertEqual(q1["credit_out"], 68.5)
		self.assertEqual(q1["checks"]["unpaid_invoices"][0]["vat_waiting"], 100)

		purchasing.pay_invoice(pi["name"], 600, "Virement bancaire", "2026-04-10", "VIR-2")
		row = frappe.db.get_value("Purchase Invoice Item", {"parent": pi["name"]}, "name")
		returns.create_debit_note(pi["name"], [{"row": row, "qty": 1}], "AV-Q2")  # 120 TTC = 20 VAT back

		q2 = vat.summary("2026-04-01")
		self.assertEqual(q2["credit_in"], 68.5)
		self.assertEqual(q2["deductible_overheads"], 80)  # 200 − 20 credited − 100 already deducted
		self.assertEqual(q2["credit_out"], 148.5)
		self.assertEqual(q2["payable"], 0)

	def test_cash_above_limit_loses_vat(self):
		pi = self.purchase("2026-07-01", 6000, "FA-Q3")
		purchasing.pay_invoice(pi["name"], 6000, "Espèces", "2026-07-15")
		q3 = vat.summary("2026-07-01")
		self.assertEqual(q3["deductible_overheads"], 1000)
		self.assertEqual(q3["cash_vat_lost"], 166.67)
		self.assertEqual(q3["checks"]["cash_over_limits"][0]["over"], 1000)
		self.assertEqual(q3["credit_out"], flt(1000 - 166.67, 2))

	def test_zero_period_reminder_and_deadline(self):
		q = vat.summary("2026-01-01")
		self.assertTrue(q["zero_declaration"])
		self.assertEqual(q["deadline"], "2026-04-20")

	def test_missing_ice_is_flagged(self):
		pi = purchasing.save_invoice(
			{
				"supplier": self.supplier,
				"bill_no": "FA-NOICE",
				"posting_date": "2026-05-02",
				"lines": [{"item_code": self.overhead, "qty": 1, "rate": 120}],
				"pp_company_ice_on_invoice": 0,
			}
		)
		purchasing.submit_invoice(pi["name"])
		q = vat.summary("2026-04-01")
		self.assertEqual([i["bill_no"] for i in q["checks"]["invoices_without_ice"]], ["FA-NOICE"])

	def test_customer_return_appears_in_the_vat_summary(self):
		"""Acceptance: a customer return reverses the VAT and shows in the VAT summary."""
		from erpnext.controllers.sales_and_purchase_return import make_return_doc

		sale = self.sale("2026-08-03", rate=240)  # 40.00 VAT
		ret = make_return_doc("Sales Invoice", sale.name)
		ret.posting_date = "2026-08-20"
		ret.set_posting_time = 1
		ret.insert()
		ret.submit()
		q = vat.summary("2026-07-01")
		self.assertEqual(q["collected_total"], 0)
		self.assertEqual(q["ledger"]["collected"], 0)
		self.assertEqual(q["collected"], [], "the sale and its return cancel out: no VAT line left")
