import frappe
from frappe.utils import add_days, flt, today

from parapilot.api import customers, pos, returns, stock
from parapilot.tests.utils import TEST_CASHIER, ParaPilotTestCase, TillTestCase

CREAM = "6111000000014"


def _bin(item, warehouse):
	return flt(frappe.db.get_value("Bin", {"item_code": item, "warehouse": warehouse}, "actual_qty"))


class TestStock(ParaPilotTestCase):
	def setUp(self):
		super().setUp()
		self.cream = self.item_by_barcode(CREAM)
		self.shop = self.settings.shop_floor_warehouse
		self.back = self.settings.back_store_warehouse
		# Put 4 units in the back store first.
		stock.transfer([{"item_code": self.cream, "qty": 4}], source="shop_floor", target="back_store")

	def test_transfer_back_store_to_shop_floor(self):
		before = _bin(self.cream, self.shop)
		stock.transfer([{"item_code": self.cream, "qty": 3}])
		self.assertEqual(_bin(self.cream, self.shop) - before, 3)
		overview = stock.stock_overview(search=CREAM)["items"][0]
		self.assertEqual(overview["back_store"], 1)

	def test_overview_lists_stocked_and_watched_products(self):
		"""A large catalogue: products never stocked only show up through search."""
		from parapilot.api.catalog import save_product

		never = save_product({"item_name": "_Test jamais stocké", "item_group": "Visage", "price_ttc": 10})["item_code"]
		listed = lambda: {r["item_code"] for r in stock.stock_overview()["items"]}  # noqa: E731
		self.assertIn(self.cream, listed())
		self.assertNotIn(never, listed())
		self.assertEqual(stock.stock_overview(search="_Test jamais")["items"][0]["item_code"], never)
		frappe.db.set_value("Item", never, "pp_min_stock", 2)
		self.assertIn(never, listed())

	def test_expired_write_off_goes_to_its_expense_account(self):
		batch = frappe.get_doc(
			{"doctype": "Batch", "batch_id": "_TEST-EXP", "item": self.cream, "expiry_date": add_days(today(), 10)}
		).insert()
		receipt = frappe.get_doc(
			{
				"doctype": "Stock Entry",
				"stock_entry_type": "Material Receipt",
				"company": self.company,
				"items": [
					{"item_code": self.cream, "qty": 2, "t_warehouse": self.shop, "basic_rate": 100, "batch_no": batch.name, "use_serial_batch_fields": 1}
				],
			}
		).insert()
		receipt.submit()
		board = stock.expiry_board(30)
		row = next(b for b in board["batches"] if b["batch_no"] == batch.name)
		self.assertEqual(row["bucket"], "30")
		self.assertEqual(row["qty"], 2)
		self.assertEqual(row["value"], 200)

		result = stock.write_off([{"item_code": self.cream, "qty": 2, "batch_no": batch.name}], "expired")
		accounts = frappe.get_all(
			"GL Entry", filters={"voucher_no": result["name"], "is_cancelled": 0, "debit": [">", 0]}, pluck="account"
		)
		self.assertTrue(any(a.startswith("61853") for a in accounts), accounts)
		self.assertNotIn(batch.name, [b["batch_no"] for b in stock.expiry_board(30)["batches"]])

	def test_count_difference_needs_manager_approval(self):
		self.as_user("stock@dev.local")
		sheet = stock.count_sheet("back_store")
		rows = [r for r in sheet["rows"] if r["item_code"] == self.cream]
		self.assertNotIn("expected", rows[0], "the count is blind")
		# Count one unit less than there is on the first batch in the back store.
		batches = {b["batch_no"]: b["qty"] for b in stock.item_batches(self.cream, "back_store")}
		first = next(r for r in rows if r["batch_no"] in batches)
		counted = [{**first, "counted": batches[first["batch_no"]] - 1}]
		result = stock.submit_count("back_store", counted)
		self.assertEqual(result["differences"], 1)
		self.assertEqual(result["rows"][0]["difference"], -1)
		self.assertFalse(result["can_approve"])
		with self.assertRaises(frappe.PermissionError):
			stock.approve_count(result["name"])
		self.as_user("manager@dev.local")
		self.assertEqual(stock.approve_count(result["name"])["docstatus"], 1)

	def test_count_without_difference_creates_nothing(self):
		batches = stock.item_batches(self.cream, "back_store")
		rows = [{"item_code": self.cream, "batch_no": b["batch_no"], "counted": b["qty"]} for b in batches]
		self.assertEqual(stock.submit_count("back_store", rows)["differences"], 0)


class TestReturns(TillTestCase):
	"""Runs as the test cashier with an open test till (see TillTestCase)."""

	def test_customer_return_reverses_vat_and_goes_to_quarantine(self):
		cream = self.item_by_barcode(CREAM)
		sale = self.sale(
			"TESTRET000001",
			[{"item_code": cream, "qty": 2, "price": 189, "rate": 189}],
			[{"mode_of_payment": "Espèces", "amount": 378}],
		)
		found = returns.find_sale("TESTRET000001")
		self.assertEqual(found["name"], sale["name"])
		quarantine = self.settings.quarantine_warehouse
		before = _bin(cream, quarantine)
		# 189 TTC is under the 200 DH threshold: no PIN needed.
		receipt = returns.submit_return(
			sale["name"], [{"row": found["lines"][0]["row"], "qty": 1, "to_quarantine": 1}], "Espèces"
		)
		self.assertEqual(receipt["totals"]["ttc"], -189)
		self.assertEqual(receipt["totals"]["vat"], -31.5)
		self.assertEqual(_bin(cream, quarantine) - before, 1)
		self.assertEqual(returns.find_sale(sale["name"])["lines"][0]["returnable"], 1)
		z = pos.close_till({"Espèces": 500 + 378 - 189, "Carte bancaire": 0})
		self.assertEqual(z["returns"], {"count": 1, "total": -189})
		self.assertEqual(next(p for p in z["payments"] if p["mode_of_payment"] == "Espèces")["difference"], 0)

	def test_cashier_needs_manager_pin_above_threshold(self):
		cream = self.item_by_barcode(CREAM)
		sale = self.sale(
			"TESTRET000002",
			[{"item_code": cream, "qty": 2, "price": 189, "rate": 189}],
			[{"mode_of_payment": "Espèces", "amount": 378}],
		)
		row = returns.find_sale(sale["name"])["lines"][0]["row"]
		frappe.set_user("Administrator")
		returns.store_pin("manager@dev.local", "4321")
		# Saving the user again (as Frappe does when a role profile changes) must keep the PIN.
		frappe.get_doc("User", "manager@dev.local").save(ignore_permissions=True)
		frappe.set_user(TEST_CASHIER)
		with self.assertRaises(frappe.PermissionError):
			returns.submit_return(sale["name"], [{"row": row, "qty": 2}], "Espèces", pin="0000")
		receipt = returns.submit_return(sale["name"], [{"row": row, "qty": 2}], "Espèces", pin="4321")
		self.assertEqual(receipt["totals"]["ttc"], -378)
		with self.assertRaises(frappe.ValidationError):
			returns.submit_return(sale["name"], [{"row": row, "qty": 1}], "Espèces", pin="4321")

	def test_named_customer_by_phone(self):
		created = customers.create("Salma Test", "+212 6 61 23 45 67", 1)
		self.assertEqual(created["pp_phone"], "0661234567")
		self.assertTrue(created["pp_marketing_consent_on"])
		self.assertEqual(customers.search("0661234567")[0]["name"], created["name"])
		self.assertEqual(customers.create("Autre", "0661 23 45 67")["name"], created["name"], "same phone, same customer")


class TestSupplierReturns(ParaPilotTestCase):
	def test_debit_note_reduces_what_is_owed(self):
		from parapilot.api import purchasing

		supplier = purchasing.save_supplier({"supplier_name": "_Test Avoir", "pp_ice": "002345678000044"})["name"]
		item = frappe.db.get_value("Item", {"item_name": "Emballages et sacs"}, "name")
		invoice = purchasing.submit_invoice(
			purchasing.save_invoice(
				{"supplier": supplier, "bill_no": "FA-AV-1", "lines": [{"item_code": item, "qty": 10, "rate": 12}], "pp_company_ice_on_invoice": 1}
			)["name"]
		)
		self.assertEqual(invoice["outstanding"], 120)
		row = frappe.db.get_value("Purchase Invoice Item", {"parent": invoice["name"]}, "name")
		result = returns.create_debit_note(invoice["name"], [{"row": row, "qty": 2}], "AV-1")
		self.assertEqual(result["outstanding"], 96)
		note = frappe.get_doc("Purchase Invoice", result["debit_note"])
		self.assertEqual(note.total_taxes_and_charges, -4)  # 2 × 12 TTC at 20 %
