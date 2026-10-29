import frappe

from parapilot.api import pos
from parapilot.tests.utils import TEST_CASHIER, TEST_TILL, TillTestCase

CREAM, SHAMPOO = "6111000000014", "6111000000045"


class TestPos(TillTestCase):
	def test_cash_sale_with_change_and_fefo_batches(self):
		from erpnext.stock.doctype.batch.batch import get_batch_qty

		cream = self.item_by_barcode(CREAM)
		warehouse = frappe.db.get_value("POS Profile", TEST_TILL, "warehouse")
		in_stock = {b.batch_no for b in get_batch_qty(item_code=cream, warehouse=warehouse) if b.qty > 0}
		expiry = lambda b: frappe.db.get_value("Batch", b, "expiry_date")  # noqa: E731
		earliest = min(expiry(b) for b in in_stock)
		receipt = self.sale(
			"TESTPOS000001",
			[{"item_code": cream, "qty": 1, "price": 189, "rate": 189}],
			[{"mode_of_payment": "Espèces", "amount": 200}],
		)
		self.assertEqual(receipt["totals"]["ttc"], 189)
		self.assertEqual(receipt["totals"]["vat"], 31.5)
		self.assertEqual(receipt["change"], 11)
		batch = frappe.db.sql(
			"""select e.batch_no from `tabSerial and Batch Entry` e
			join `tabSerial and Batch Bundle` b on b.name = e.parent where b.voucher_no = %s""",
			receipt["name"],
		)[0][0]
		# Several lots can share the earliest date; any of them is first-expired-first-out.
		self.assertEqual(expiry(batch), earliest, "the batch that expires first must be sold first")

	def test_device_time_is_converted_to_shop_time(self):
		moment = pos._shop_time("2026-07-01T10:15:00.000Z")
		self.assertIsNone(moment.tzinfo)
		self.assertEqual(moment.strftime("%H:%M"), "11:15")  # Africa/Casablanca is UTC+1

	def test_device_clock_behind_still_counts_in_closing(self):
		"""A tablet whose clock is 3 minutes slow: the sale must still be in the Z report."""
		from datetime import UTC, datetime, timedelta

		slow = (datetime.now(UTC) - timedelta(minutes=3)).isoformat().replace("+00:00", "Z")
		pos.submit_sale(
			{
				"client_id": "TESTPOS000007",
				"sold_at": slow,
				"lines": [{"item_code": self.item_by_barcode(CREAM), "qty": 1, "price": 189, "rate": 189}],
				"payments": [{"mode_of_payment": "Espèces", "amount": 189}],
			}
		)
		self.assertEqual(pos.get_closing_preview()["tickets"], 1)

	def test_retry_never_creates_a_duplicate(self):
		args = (
			"TESTPOS000002",
			[{"item_code": self.item_by_barcode(CREAM), "qty": 1, "price": 189, "rate": 189}],
			[{"mode_of_payment": "Espèces", "amount": 189}],
		)
		first = self.sale(*args)
		second = self.sale(*args)
		self.assertEqual(first["name"], second["name"])
		self.assertTrue(second["duplicate"])
		self.assertEqual(frappe.db.count("Sales Invoice", {"pp_client_uuid": "TESTPOS000002"}), 1)

	def test_cashier_discount_limit(self):
		with self.assertRaises(frappe.ValidationError):
			self.sale(
				"TESTPOS000003",
				[{"item_code": self.item_by_barcode(CREAM), "qty": 1, "price": 189, "rate": 151.2}],
				[{"mode_of_payment": "Espèces", "amount": 151.2}],
			)

	def test_discounted_rate_is_kept_to_the_centime(self):
		# 159.50 − 7.5 % = 147.5375 → 147.54 per unit, as the till computes it.
		receipt = self.sale(
			"TESTPOS000004",
			[{"item_code": self.item_by_barcode(SHAMPOO), "qty": 3, "price": 159.5, "rate": 147.54}],
			[{"mode_of_payment": "Carte bancaire", "amount": 442.62}],
		)
		self.assertEqual(receipt["totals"]["ttc"], 442.62)

	def test_closing_reports_the_cash_difference(self):
		self.sale(
			"TESTPOS000005",
			[{"item_code": self.item_by_barcode(CREAM), "qty": 1, "price": 189, "rate": 189}],
			[{"mode_of_payment": "Espèces", "amount": 189}],
		)
		z = pos.close_till({"Espèces": 680, "Carte bancaire": 0})
		cash = next(p for p in z["payments"] if p["mode_of_payment"] == "Espèces")
		self.assertEqual(cash["expected"], 689)
		self.assertEqual(cash["difference"], -9)
		self.assertEqual(frappe.db.get_value("POS Closing Entry", z["name"], "docstatus"), 1)
		with self.assertRaises(pos.TillClosedError):
			self.sale(
				"TESTPOS000006",
				[{"item_code": self.item_by_barcode(CREAM), "qty": 1, "price": 189, "rate": 189}],
				[{"mode_of_payment": "Espèces", "amount": 189}],
			)

	def test_cash_taken_out_lowers_expected_cash(self):
		self.sale(
			"TESTPOS000010",
			[{"item_code": self.item_by_barcode(CREAM), "qty": 1, "price": 189, "rate": 189}],
			[{"mode_of_payment": "Espèces", "amount": 189}],
		)
		pos.record_cash_out(40, "Sacs plastiques")
		preview = pos.get_closing_preview()
		cash = next(p for p in preview["expected"] if p["mode_of_payment"] == "Espèces")
		self.assertEqual(cash["expected"], 500 + 189 - 40)
		self.assertEqual(preview["cash_outs"][0]["reason"], "Sacs plastiques")
		z = pos.close_till({"Espèces": 649, "Carte bancaire": 0})
		self.assertEqual(next(p for p in z["payments"] if p["mode_of_payment"] == "Espèces")["difference"], 0)

	def test_business_customer_on_the_invoice(self):
		customer = pos.create_business_customer("_Test Clinique SARL", "003 456 789 000 123", "12 rue de la Paix", "Agadir")
		self.assertEqual(customer["pp_ice"], "003456789000123")
		receipt = pos.submit_sale(
			{
				"client_id": "TESTPOS000011",
				"customer": customer["name"],
				"lines": [{"item_code": self.item_by_barcode(CREAM), "qty": 1, "price": 189, "rate": 189}],
				"payments": [{"mode_of_payment": "Carte bancaire", "amount": 189}],
			}
		)
		self.assertEqual(receipt["customer"]["ice"], "003456789000123")
		self.assertIn("Agadir", receipt["customer"]["address"])
		with self.assertRaises(frappe.ValidationError):
			pos.create_business_customer("_Test sans ICE", "12345")
