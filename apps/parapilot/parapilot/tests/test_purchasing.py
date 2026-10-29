import frappe
from frappe.utils import add_days, add_months, flt, today

from parapilot.api import purchasing
from parapilot.tests.utils import ParaPilotTestCase

CREAM = "6111000000014"


class TestPurchasing(ParaPilotTestCase):
	def setUp(self):
		super().setUp()
		self.cream = self.item_by_barcode(CREAM)
		self.supplier = purchasing.save_supplier(
			{"supplier_name": "_Test Labo Dermo", "pp_ice": "002345678000012", "pp_lead_time_days": 5}
		)["name"]

	def stock(self, warehouse):
		return flt(frappe.db.get_value("Bin", {"item_code": self.cream, "warehouse": warehouse}, "actual_qty"))

	def test_order_receive_invoice_pay(self):
		settings = self.settings
		order = purchasing.save_purchase_order(
			{"supplier": self.supplier, "lines": [{"item_code": self.cream, "qty": 12, "rate": 120}]}
		)
		self.assertEqual(order["docstatus"], 0)
		self.assertEqual(order["totals"]["ht"], 1200)  # 12 × 120 TTC = 1 440 TTC = 1 200 HT
		self.assertEqual(order["totals"]["vat"], 240)
		order = purchasing.submit_purchase_order(order["name"])

		# Delivery: 10 good + 2 damaged, plus 2 free units, lot with expiry in a year.
		draft = purchasing.get_receipt_draft(order["name"])
		line = draft["lines"][0]
		shop_before = self.stock(settings.shop_floor_warehouse)
		quarantine_before = self.stock(settings.quarantine_warehouse)
		result = purchasing.submit_receipt(
			{
				"supplier": self.supplier,
				"purchase_order": order["name"],
				"supplier_delivery_note": "BL-TEST-1",
				"lines": [
					{
						**line,
						"qty": 10,
						"damaged_qty": 2,
						"free_qty": 2,
						"lot": "LOT-TEST-A",
						"expiry_date": add_months(today(), 12),
					}
				],
			}
		)
		self.assertEqual(self.stock(settings.shop_floor_warehouse) - shop_before, 12)  # 10 paid + 2 free
		self.assertEqual(self.stock(settings.quarantine_warehouse) - quarantine_before, 2)
		self.assertTrue(result["damage_return"], "damaged units must get a draft return")
		self.assertEqual(frappe.db.get_value("Purchase Receipt", result["damage_return"], "docstatus"), 0)
		# Free units lower the cost per unit: the delivery adds 10 × 100 HT of value for 12 units.
		entries = frappe.get_all(
			"Stock Ledger Entry",
			filters={"voucher_no": result["name"], "warehouse": settings.shop_floor_warehouse, "is_cancelled": 0},
			fields=["actual_qty", "stock_value_difference"],
		)
		self.assertEqual(sum(e.actual_qty for e in entries), 12)
		self.assertAlmostEqual(sum(flt(e.stock_value_difference) for e in entries), 1000, places=2)
		self.assertEqual(frappe.db.get_value("Purchase Order", order["name"], "per_received"), 100)

		# Invoice for that delivery, 2 % dearer than the delivery note: highlighted.
		self.assertIn(result["name"], [r.name for r in purchasing.open_receipts(self.supplier)])
		preview = purchasing.preview_invoice(self.supplier, [result["name"]])
		lines = [{**l, "rate": 122.4 if not l["is_free_item"] else 0} for l in preview["lines"]]
		invoice = purchasing.save_invoice(
			{"supplier": self.supplier, "bill_no": "FA-TEST-1", "receipts": [result["name"]], "lines": lines, "pp_company_ice_on_invoice": 1}
		)
		self.assertEqual([w["code"] for w in invoice["warnings"]], ["price_differs"])
		invoice = purchasing.submit_invoice(invoice["name"])
		self.assertEqual(invoice["totals"]["ttc"], 1224)  # 10 × 122.40; free units at 0
		vat_row = frappe.get_all(
			"Purchase Taxes and Charges", filters={"parent": invoice["name"], "tax_amount": [">", 0]}, pluck="account_head"
		)
		self.assertTrue(vat_row[0].startswith("345521"), vat_row)

		# Cash payment above 5 000 DH a day: the VAT on the excess is at risk.
		check = purchasing.check_cash_limit(invoice["name"], 1224)
		self.assertEqual(check["over_amount"], 0)
		paid = purchasing.pay_invoice(invoice["name"], 1224, "Espèces")
		self.assertEqual(paid["outstanding"], 0)
		self.assertEqual(len(paid["payments"]), 1)

	def test_cash_limit_reports_vat_at_risk(self):
		pi = purchasing.save_invoice(
			{
				"supplier": self.supplier,
				"bill_no": "FA-TEST-2",
				"lines": [{"item_code": self.overhead("Électricité"), "qty": 1, "rate": 6000}],
				"pp_company_ice_on_invoice": 1,
			}
		)
		pi = purchasing.submit_invoice(pi["name"])
		check = purchasing.check_cash_limit(pi["name"], 6000)
		self.assertEqual(check["over_amount"], 1000)
		self.assertEqual(check["vat_at_risk"], 166.67)  # 1 000 TTC at 20 %

	def test_overhead_vat_goes_to_overheads_account(self):
		pi = purchasing.save_invoice(
			{
				"supplier": self.supplier,
				"bill_no": "FA-TEST-3",
				"lines": [{"item_code": self.overhead("Internet et téléphone"), "qty": 1, "rate": 360}],
				"pp_company_ice_on_invoice": 1,
			}
		)
		self.assertEqual(pi["totals"]["vat"], 60)
		heads = frappe.get_all(
			"Purchase Taxes and Charges", filters={"parent": pi["name"], "tax_amount": [">", 0]}, pluck="account_head"
		)
		self.assertTrue(heads[0].startswith("345523"), heads)
		expense = frappe.db.get_value("Purchase Invoice Item", {"parent": pi["name"]}, "expense_account")
		self.assertTrue(expense.startswith("6145"), expense)

	def test_expired_lot_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			purchasing.submit_receipt(
				{
					"supplier": self.supplier,
					"lines": [{"item_code": self.cream, "qty": 1, "rate": 120, "lot": "LOT-OLD", "expiry_date": add_days(today(), -1)}],
				}
			)

	def test_same_supplier_invoice_number_twice_is_refused(self):
		args = {
			"supplier": self.supplier,
			"bill_no": "FA-TEST-DUP",
			"lines": [{"item_code": self.overhead("Eau"), "qty": 1, "rate": 110}],
			"pp_company_ice_on_invoice": 1,
		}
		purchasing.submit_invoice(purchasing.save_invoice(args)["name"])
		with self.assertRaises(frappe.ValidationError):
			purchasing.submit_invoice(purchasing.save_invoice(args)["name"])

	def test_stock_clerk_prepares_orders_but_cannot_submit(self):
		self.as_user("stock@dev.local")
		order = purchasing.save_purchase_order(
			{"supplier": self.supplier, "lines": [{"item_code": self.cream, "qty": 1, "rate": 120}]}
		)
		self.assertFalse(order["can_submit"])
		with self.assertRaises(frappe.PermissionError):
			purchasing.submit_purchase_order(order["name"])

	def overhead(self, name):
		return frappe.db.get_value("Item", {"item_name": name, "item_group": "Frais généraux"}, "name")

	def test_one_invoice_for_three_delivery_notes(self):
		"""Acceptance: one supplier invoice from 3 delivery notes; a price over 1 % away is highlighted."""
		receipts = []
		for n in range(3):
			receipts.append(
				purchasing.submit_receipt(
					{
						"supplier": self.supplier,
						"supplier_delivery_note": f"BL-3-{n}",
						"lines": [
							{"item_code": self.cream, "qty": 2, "rate": 120, "lot": f"LOT-3-{n}", "expiry_date": add_months(today(), 12)}
						],
					}
				)["name"]
			)
		self.assertEqual({r.name for r in purchasing.open_receipts(self.supplier)}, set(receipts))
		lines = purchasing.preview_invoice(self.supplier, receipts)["lines"]
		self.assertEqual(len(lines), 3)
		lines[1]["rate"] = 125  # +4.2 % on the second delivery
		invoice = purchasing.save_invoice(
			{"supplier": self.supplier, "bill_no": "FA-3BL", "receipts": receipts, "lines": lines, "pp_company_ice_on_invoice": 1}
		)
		self.assertEqual(invoice["receipts"], sorted(receipts))
		self.assertEqual([w["receipt_rate"] for w in invoice["warnings"]], [120])
		purchasing.submit_invoice(invoice["name"])
		self.assertEqual(purchasing.open_receipts(self.supplier), [])

	def test_delivery_note_entered_without_vat_is_billed_with_vat(self):
		"""Delivery notes typed in ERPNext before ParaPilot carry no VAT template, so the stock was valued
		with VAT. Their supplier invoice still deducts the VAT and revalues the stock without it."""
		from erpnext.stock.doctype.repost_item_valuation.repost_item_valuation import repost_entries

		batch = frappe.get_doc(
			{"doctype": "Batch", "batch_id": "_TEST-OLD-PR", "item": self.cream, "expiry_date": add_months(today(), 12)}
		).insert()
		receipt = frappe.get_doc(
			{
				"doctype": "Purchase Receipt",
				"company": self.company,
				"supplier": self.supplier,
				"set_warehouse": self.settings.shop_floor_warehouse,
				"items": [{"item_code": self.cream, "qty": 2, "rate": 120, "batch_no": batch.name, "use_serial_batch_fields": 1}],
			}
		)
		receipt.insert()
		receipt.submit()
		self.assertFalse(receipt.taxes)
		self.assertEqual(receipt.items[0].valuation_rate, 120)

		lines = purchasing.preview_invoice(self.supplier, [receipt.name])["lines"]
		invoice = purchasing.save_invoice(
			{"supplier": self.supplier, "bill_no": "FA-OLD-1", "receipts": [receipt.name], "lines": lines, "pp_company_ice_on_invoice": 1}
		)
		self.assertEqual(invoice["totals"]["vat"], 40)
		purchasing.submit_invoice(invoice["name"])
		repost_entries()
		self.assertEqual(frappe.db.get_value("Purchase Receipt Item", receipt.items[0].name, "valuation_rate"), 100)

	def test_purchases_report_shows_deliveries_before_the_invoice(self):
		"""Suppliers invoice at the end of the month: a delivery counts as soon as it is received."""
		from parapilot.api import reports

		def supplier_row():
			rows = reports.run("purchases_by_supplier", {"from_date": today(), "to_date": today()})["rows"]
			return next(r for r in rows if r["supplier_name"] == "_Test Labo Dermo")

		receipt = purchasing.submit_receipt(
			{
				"supplier": self.supplier,
				"supplier_delivery_note": "BL-RT-1",
				"lines": [{"item_code": self.cream, "qty": 2, "rate": 120, "lot": "LOT-RT-1", "expiry_date": add_months(today(), 12)}],
			}
		)["name"]
		row = supplier_row()
		self.assertEqual((row["received_ttc"], row["to_invoice_ttc"], row["invoices"]), (240, 240, 0))

		lines = purchasing.preview_invoice(self.supplier, [receipt])["lines"]
		invoice = purchasing.save_invoice(
			{"supplier": self.supplier, "bill_no": "FA-RT-1", "receipts": [receipt], "lines": lines, "pp_company_ice_on_invoice": 1}
		)
		purchasing.submit_invoice(invoice["name"])
		row = supplier_row()
		self.assertEqual((row["to_invoice_ttc"], row["invoices"], row["invoiced_ht"], row["invoiced_vat"]), (0, 1, 200, 40))
