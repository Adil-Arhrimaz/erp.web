app_name = "parapilot"
app_title = "ParaPilot"
app_publisher = "Derma Routine"
app_description = "Parapharmacy layer for ERPNext (Morocco)"
app_email = "contact@dermaroutine.ma"
app_license = "Proprietary"

required_apps = ["erpnext"]

before_install = "parapilot.setup.install.before_install"
after_install ="parapilot.setup.install.after_install"
after_migrate = "parapilot.setup.install.after_migrate"

_vat_category = "parapilot.validations.vat.validate_items_have_vat_category"

doc_events = {
	"Company": {"validate": "parapilot.validations.legal_ids.validate_company"},
	"Supplier": {"validate": "parapilot.validations.legal_ids.validate_party_ice"},
	"Customer": {"validate": "parapilot.validations.legal_ids.validate_party_ice"},
	"Item": {"validate": "parapilot.validations.vat.validate_item"},
	"Sales Invoice": {"validate": _vat_category},
	"POS Invoice": {"validate": _vat_category},
	"Purchase Order": {"validate": _vat_category},
	"Purchase Receipt": {"validate": _vat_category},
	"Purchase Invoice": {
		"validate": [_vat_category, "parapilot.validations.legal_ids.warn_missing_company_ice"],
	},
}
