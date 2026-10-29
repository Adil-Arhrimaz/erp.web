import frappe

from parapilot.tests.utils import ParaPilotTestCase


class TestPermissions(ParaPilotTestCase):
	def test_cashier_cannot_change_prices_or_items(self):
		self.as_user("cashier@dev.local")
		self.assertFalse(frappe.has_permission("Item Price", "write"))
		self.assertFalse(frappe.has_permission("Item", "write"))
		self.assertTrue(frappe.has_permission("Sales Invoice", "submit"))

	def test_stock_clerk_drafts_purchase_orders_only(self):
		self.as_user("stock@dev.local")
		self.assertTrue(frappe.has_permission("Purchase Order", "create"))
		self.assertFalse(frappe.has_permission("Purchase Order", "submit"))
		self.assertTrue(frappe.has_permission("Purchase Receipt", "submit"))

	def test_accountant_cannot_edit_products(self):
		self.as_user("accountant@dev.local")
		self.assertFalse(frappe.has_permission("Item", "write"))
		self.assertTrue(frappe.has_permission("Purchase Invoice", "create"))

	def test_ai_role_can_never_submit_cancel_or_delete(self):
		from parapilot.setup.install import AI, CUSTOM_ROLE_PERMISSIONS

		for doctype, ptypes in CUSTOM_ROLE_PERMISSIONS[AI].items():
			self.assertFalse({"submit", "cancel", "delete"} & set(ptypes), doctype)
		for doctype in ("Customer", "Item Price", "Item Tax Template"):
			perms = frappe.get_all("Custom DocPerm", filters={"parent": doctype, "role": AI}, pluck="write")
			self.assertFalse(any(perms), doctype)
