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

	def old_receipt(self, batch: str):
		"""A delivery note as typed in ERPNext before ParaPilot: no VAT template, stock valued VAT included."""
		receipt = frappe.get_doc(
			{
				"doctype": "Purchase Receipt",
				"company": self.company,
				"supplier": self.supplier,
				"set_warehouse": self.settings.shop_floor_warehouse,
				"items": [{"item_code": self.cream, "qty": 2, "rate": 120, "batch_no": batch, "use_serial_batch_fields": 1}],
			}
		)
		receipt.flags.ignore_parapilot_vat = True
		receipt.insert()
		receipt.submit()
		return receipt

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
		receipt = self.old_receipt(batch.name)
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

	def receive(self, qty=2, rate=120, lot="LOT-C-1", note="BL-C-1"):
		return purchasing.submit_receipt(
			{
				"supplier": self.supplier,
				"supplier_delivery_note": note,
				"lines": [{"item_code": self.cream, "qty": qty, "rate": rate, "lot": lot, "expiry_date": add_months(today(), 12)}],
			}
		)["name"]

	def issue(self, qty, batch):
		entry = frappe.get_doc(
			{
				"doctype": "Stock Entry",
				"stock_entry_type": "Material Issue",
				"company": self.company,
				"items": [{"item_code": self.cream, "qty": qty, "s_warehouse": self.settings.shop_floor_warehouse, "batch_no": batch, "use_serial_batch_fields": 1}],
			}
		)
		entry.insert()
		entry.submit()

	def test_correct_a_delivery_note_after_part_was_sold(self):
		"""2 creams received at 120 were really 3 at 110; one is already gone. The correction replaces the
		delivery note at its original date and the lot keeps what is left."""
		name = self.receive()
		self.issue(1, "LOT-C-1")
		draft = purchasing.get_receipt_draft(correct=name)
		self.assertEqual(draft["corrects"], name)
		self.assertEqual([(l["qty"], l["lot"], l["rate"]) for l in draft["lines"]], [(2, "LOT-C-1", 120)])

		line = {**draft["lines"][0], "qty": 3, "rate": 110}
		corrected = purchasing.submit_receipt({"supplier": self.supplier, "supplier_delivery_note": "BL-C-1", "corrects": name, "lines": [line]})["name"]
		original = purchasing.get_receipt(name)
		self.assertEqual(original["docstatus"], 2)
		self.assertEqual(original["corrected_by"], corrected)
		new = purchasing.get_receipt(corrected)
		self.assertEqual((new["corrects"], new["posting_date"], new["lines"][0]["qty"]), (name, original["posting_date"], 3))
		self.assertEqual(new["totals"]["ttc"], 330)
		from erpnext.stock.doctype.batch.batch import get_batch_qty

		self.assertEqual(get_batch_qty("LOT-C-1", self.settings.shop_floor_warehouse), 2)

	def test_cancel_a_delivery_note_recorded_by_mistake(self):
		name = self.receive(note="BL-C-2", lot="LOT-C-2")
		before = self.stock(self.settings.shop_floor_warehouse)
		receipt = purchasing.cancel_receipt(name, "Saisie en double")
		self.assertEqual(receipt["docstatus"], 2)
		self.assertEqual(receipt["blocked"], "cancelled")
		self.assertEqual(before - self.stock(self.settings.shop_floor_warehouse), 2)
		listed = next(r for r in purchasing.list_receipts(self.supplier) if r.name == name)
		self.assertEqual(listed.docstatus, 2)

	def test_cannot_cancel_goods_already_sold(self):
		name = self.receive(note="BL-C-3", lot="LOT-C-3")
		self.issue(2, "LOT-C-3")
		with self.assertRaisesRegex(frappe.ValidationError, "already sold or moved"):
			purchasing.cancel_receipt(name, "Erreur")

	def test_invoiced_delivery_note_cannot_be_corrected(self):
		name = self.receive(note="BL-C-4", lot="LOT-C-4")
		lines = purchasing.preview_invoice(self.supplier, [name])["lines"]
		purchasing.save_invoice({"supplier": self.supplier, "bill_no": "FA-C-4", "receipts": [name], "lines": lines})
		self.assertEqual(purchasing.get_receipt(name)["blocked"], "invoiced")
		with self.assertRaisesRegex(frappe.ValidationError, "supplier invoice includes"):
			purchasing.cancel_receipt(name, "Erreur")

	def test_correcting_an_old_delivery_note_adds_the_vat(self):
		"""A delivery note typed in ERPNext without VAT, partly sold: the correction values it without VAT."""
		from erpnext.stock.doctype.repost_item_valuation.repost_item_valuation import repost_entries

		frappe.get_doc({"doctype": "Batch", "batch_id": "_TEST-OLD-C", "item": self.cream, "expiry_date": add_months(today(), 12)}).insert()
		old = self.old_receipt("_TEST-OLD-C")
		self.issue(1, "_TEST-OLD-C")
		self.assertFalse(purchasing.get_receipt(old.name)["vat_included"])

		draft = purchasing.get_receipt_draft(correct=old.name)
		corrected = purchasing.submit_receipt({"supplier": self.supplier, "corrects": old.name, "lines": draft["lines"]})["name"]
		repost_entries()
		new = purchasing.get_receipt(corrected)
		self.assertTrue(new["vat_included"])
		self.assertEqual(new["totals"]["vat"], 40)
		self.assertEqual(frappe.db.get_value("Purchase Receipt Item", {"parent": corrected}, "valuation_rate"), 100)

	def test_delivery_note_typed_in_erpnext_gets_the_vat(self):
		"""Someone enters a delivery note in the ERPNext desk and forgets the VAT: ParaPilot adds it."""
		frappe.get_doc({"doctype": "Batch", "batch_id": "_TEST-DESK", "item": self.cream, "expiry_date": add_months(today(), 12)}).insert()
		receipt = frappe.get_doc(
			{
				"doctype": "Purchase Receipt",
				"company": self.company,
				"supplier": self.supplier,
				"set_warehouse": self.settings.shop_floor_warehouse,
				"items": [{"item_code": self.cream, "qty": 2, "rate": 120, "batch_no": "_TEST-DESK", "use_serial_batch_fields": 1}],
			}
		).insert()
		self.assertEqual(receipt.taxes_and_charges, self.settings.purchase_taxes_template)
		self.assertEqual((receipt.grand_total, receipt.total_taxes_and_charges), (240, 40))
		receipt.submit()
		self.assertEqual(receipt.items[0].valuation_rate, 100)

	def test_all_old_delivery_notes_get_the_vat_at_takeover(self):
		"""At the move to ParaPilot, every delivery note without VAT and not invoiced is corrected; an
		invoiced one is listed instead."""
		from parapilot.setup.adopt import fix_receipts_without_vat

		for batch in ("_TEST-OLD-1", "_TEST-OLD-2"):
			frappe.get_doc({"doctype": "Batch", "batch_id": batch, "item": self.cream, "expiry_date": add_months(today(), 12)}).insert()
		sold = self.old_receipt("_TEST-OLD-1")
		self.issue(1, "_TEST-OLD-1")
		invoiced = self.old_receipt("_TEST-OLD-2")
		lines = purchasing.preview_invoice(self.supplier, [invoiced.name])["lines"]
		purchasing.save_invoice({"supplier": self.supplier, "bill_no": "FA-OLD-2", "receipts": [invoiced.name], "lines": lines})

		fixed, not_fixed = fix_receipts_without_vat(self.company)
		self.assertGreaterEqual(fixed, 1)
		corrected = purchasing.get_receipt(sold.name)["corrected_by"]
		self.assertTrue(purchasing.get_receipt(corrected)["vat_included"])
		self.assertEqual(frappe.db.get_value("Purchase Receipt Item", {"parent": corrected}, "valuation_rate"), 100)
		self.assertTrue(any(line.startswith(invoiced.name) for line in not_fixed))
