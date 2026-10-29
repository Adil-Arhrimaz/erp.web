import frappe
from frappe.utils import flt

from parapilot.tests.utils import ParaPilotTestCase

CREAM = "6111000000014"  # dev seed: 189.00 DH TTC, Visage, TVA 20 %


class TestVat(ParaPilotTestCase):
	def gl(self, voucher_no):
		"""Balance per account number for one voucher (debit positive)."""
		balances = {}
		for r in frappe.get_all(
			"GL Entry",
			filters={"voucher_no": voucher_no, "is_cancelled": 0},
			fields=["account", "debit", "credit"],
		):
			number = r.account.split(" - ")[0]
			balances[number] = flt(balances.get(number, 0) + r.debit - r.credit, 2)
		return balances

	def test_sale_at_189_ttc_posts_31_50_vat(self):
		"""Spec acceptance: 189.00 TTC at 20 % = 157.50 HT + 31.50 VAT, in ERPNext."""
		si = frappe.get_doc(
			{
				"doctype": "Sales Invoice",
				"company": self.company,
				"customer": "Client comptoir",
				"taxes_and_charges": self.settings.sales_taxes_template,
				"items": [{"item_code": self.item_by_barcode(CREAM), "qty": 1, "rate": 189}],
			}
		).insert()
		si.submit()
		self.assertEqual(si.net_total, 157.5)
		self.assertEqual(si.total_taxes_and_charges, 31.5)
		self.assertEqual(si.grand_total, 189)
		self.assertEqual(si.rounded_total, 0, "totals must not be rounded to the dirham")
		gl = self.gl(si.name)
		self.assertEqual(gl["44551"], -31.5)
		self.assertEqual(gl["7111"], -157.5)

	def test_purchase_vat_goes_to_deductible_goods_account(self):
		pi = frappe.get_doc(
			{
				"doctype": "Purchase Invoice",
				"company": self.company,
				"supplier": self._supplier(),
				"taxes_and_charges": self.settings.purchase_taxes_template,
				"pp_company_ice_on_invoice": 1,
				"items": [{"item_code": self.item_by_barcode(CREAM), "qty": 1, "rate": 120}],
			}
		).insert()
		self.assertEqual(pi.net_total, 100)
		self.assertEqual(pi.total_taxes_and_charges, 20)
		row = next(t for t in pi.taxes if t.tax_amount)
		self.assertTrue(row.account_head.startswith("345521"), row.account_head)

	def test_exempt_item_carries_no_vat(self):
		group = frappe.get_doc(
			{
				"doctype": "Item Group",
				"item_group_name": "_Test exonéré",
				"parent_item_group": "All Item Groups",
				"taxes": [{"item_tax_template": self.settings.vat_template_exempt}],
			}
		).insert()
		item = frappe.get_doc(
			{"doctype": "Item", "item_name": "_Test exempt", "item_group": group.name, "stock_uom": "Nos", "is_stock_item": 0}
		).insert()
		si = frappe.get_doc(
			{
				"doctype": "Sales Invoice",
				"company": self.company,
				"customer": "Client comptoir",
				"taxes_and_charges": self.settings.sales_taxes_template,
				"items": [{"item_code": item.name, "qty": 2, "rate": 50}],
			}
		).insert()
		self.assertEqual(si.total_taxes_and_charges, 0)
		self.assertEqual(si.net_total, 100)

	def test_item_without_vat_category_is_refused(self):
		group = frappe.get_doc(
			{"doctype": "Item Group", "item_group_name": "_Test sans TVA", "parent_item_group": "All Item Groups"}
		).insert()
		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc(
				{"doctype": "Item", "item_name": "_Test no VAT", "item_group": group.name, "stock_uom": "Nos"}
			).insert()

	def test_ice_must_be_15_digits(self):
		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc({"doctype": "Supplier", "supplier_name": "_Test bad ICE", "pp_ice": "12345"}).insert()
		supplier = frappe.get_doc(
			{"doctype": "Supplier", "supplier_name": "_Test good ICE", "pp_ice": "001 234 567 000 089"}
		).insert()
		self.assertEqual(supplier.pp_ice, "001234567000089")

	def _supplier(self):
		name = "_Test Lab"
		if not frappe.db.exists("Supplier", name):
			frappe.get_doc({"doctype": "Supplier", "supplier_name": name}).insert()
		return name
