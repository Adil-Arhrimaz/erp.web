import unittest

import frappe
from frappe.tests import IntegrationTestCase


class ParaPilotTestCase(IntegrationTestCase):
	"""Runs against a site set up by ParaPilot (apply_defaults + dev users). Rolled back after each class."""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.settings = frappe.get_single("ParaPilot Settings")
		if not cls.settings.company:
			raise unittest.SkipTest("ParaPilot is not set up on this site")
		cls.company = cls.settings.company

	def setUp(self):
		super().setUp()
		# IntegrationTestCase rolls back once per class; each ParaPilot test starts from the same data.
		frappe.db.savepoint("parapilot_test")

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.rollback(save_point="parapilot_test")
		super().tearDown()

	def item_by_barcode(self, barcode: str) -> str:
		return frappe.db.get_value("Item Barcode", {"barcode": barcode}, "parent")

	def as_user(self, user: str):
		if not frappe.db.exists("User", user):
			self.skipTest(f"{user} missing: run parapilot.setup.dev_seed")
		frappe.set_user(user)


TEST_CASHIER = "pp-test-cashier@example.com"
TEST_TILL = "_Test Caisse"


class TillTestCase(ParaPilotTestCase):
	"""An open till for a test cashier of its own (rolled back), so a till open on the dev site does
	not interfere."""

	def setUp(self):
		super().setUp()
		if not frappe.db.exists("User", TEST_CASHIER):
			frappe.get_doc(
				{
					"doctype": "User",
					"email": TEST_CASHIER,
					"first_name": "Test Cashier",
					"send_welcome_email": 0,
					"roles": [{"role": "ParaPilot Cashier"}],
				}
			).insert(ignore_permissions=True)
		if not frappe.db.exists("POS Profile", TEST_TILL):
			till = frappe.copy_doc(frappe.get_doc("POS Profile", "Caisse 1"))
			till.name = TEST_TILL
			till.set("applicable_for_users", [])
			till.insert(ignore_permissions=True)
		frappe.set_user(TEST_CASHIER)
		from parapilot.api import pos

		pos.open_till(TEST_TILL, cash_float=500)

	def sale(self, client_id, lines, payments):
		# Sent like the till does: with the device's time in UTC.
		from datetime import UTC, datetime

		from parapilot.api import pos

		sold_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
		return pos.submit_sale({"client_id": client_id, "lines": lines, "payments": payments, "sold_at": sold_at})
