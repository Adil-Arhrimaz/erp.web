"""Derma Routine's move from plain ERPNext to ParaPilot: take over the company, round sales to the dirham
and give each person their ParaPilot role. Idempotent; run with the shop closed and after a backup.

bench --site <site> execute parapilot.setup.prod_cutover.run
"""

import frappe

from parapilot.setup.adopt import adopt_company

COMPANY = "Derma Routine"

# Role profile per person, as the owner decided (2026-10-29). The owner profile includes System Manager.
USERS = {
	"adilarhrimaz@gmail.com": "ParaPilot Owner",
	"assialebakhr@gmail.com": "ParaPilot Cashier",
	"mbarekaaya@gmail.com": "ParaPilot Cashier",
	"zakia@gmail.com": "ParaPilot Cashier",
	"hayataaya@gmail.com": "ParaPilot Cashier",
}


def run():
	report = adopt_company(COMPANY)
	frappe.db.set_single_value("ParaPilot Settings", "round_sales_total", 1)
	for email, profile in USERS.items():
		if not frappe.db.exists("User", email):
			report.setdefault("users_missing", []).append(email)
			continue
		user = frappe.get_doc("User", email)
		user.set("role_profiles", [{"role_profile": profile}])
		user.save(ignore_permissions=True)
	frappe.db.commit()
	for key, value in report.items():
		print(f"{key}: {value if isinstance(value, int) else len(value)}")
		if isinstance(value, list) and key != "merged":
			for line in value:
				print("   ", line)
	return report
