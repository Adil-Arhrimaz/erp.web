import frappe

from parapilot.api import settings
from parapilot.tests.utils import ParaPilotTestCase


class TestSettings(ParaPilotTestCase):
	def setUp(self):
		super().setUp()
		frappe.set_user("owner@dev.local")

	def test_import_reports_errors_line_by_line(self):
		rows = [
			{"name": "Sérum test", "family": "Visage", "barcode": "6111000000090", "price_ttc": "249,00"},
			{"name": "", "family": "Inconnue", "barcode": "6111000000091", "price_ttc": "abc"},
			{"name": "Doublon", "family": "Corps", "barcode": "6111000000014"},
		]
		result = settings.import_products(rows, dry_run=1)
		self.assertEqual(result["valid"], 1)
		self.assertEqual([e["line"] for e in result["errors"]], [3, 4])
		self.assertEqual(len(result["errors"][0]["errors"]), 4)  # no name, unknown family, bad EAN, bad price
		self.assertEqual(result["imported"], 0)

	def test_import_creates_products_when_all_lines_are_valid(self):
		rows = [{"name": "Sérum test", "brand": "Marque Z", "family": "Visage", "barcode": "6111000000090", "price_ttc": "249,00"}]
		result = settings.import_products(rows, dry_run=0)
		self.assertEqual(result["imported"], 1)
		item = frappe.db.get_value("Item Barcode", {"barcode": "6111000000090"}, "parent")
		self.assertEqual(frappe.db.get_value("Item", item, "item_group"), "Visage")

	def test_family_vat_and_accountant_confirmation(self):
		reduced = self.settings.vat_template_reduced
		data = settings.set_family("_Test Lait infantile", reduced, new=1)
		family = next(g for g in data["item_groups"] if g["name"] == "_Test Lait infantile")
		self.assertEqual(family["vat_template"], reduced)
		self.as_user("accountant@dev.local")
		self.assertEqual(settings.confirm_vat()["vat_confirmed_by"], "accountant@dev.local")

	def test_owner_invites_a_cashier(self):
		users = settings.invite_user("pp-new-cashier@example.com", "Nouvelle Caissière", "cashier", "parapilot-test-1")
		row = next(u for u in users if u["name"] == "pp-new-cashier@example.com")
		self.assertEqual(row["role"], "cashier")
		self.assertIn("ParaPilot Cashier", frappe.get_roles("pp-new-cashier@example.com"))
		with self.assertRaises(frappe.ValidationError):
			settings.update_user("owner@dev.local", enabled=0)

	def test_manager_cannot_change_vat(self):
		self.as_user("manager@dev.local")
		with self.assertRaises(frappe.PermissionError):
			settings.set_family("Visage", self.settings.vat_template_reduced)
