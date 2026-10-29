"""Moroccan chart of accounts (CGNC) for a parapharmacy, in ERPNext's chart tree format.

A trimmed CGNC: the classes and accounts a retail parapharmacy uses, numbered as in the Plan Comptable
Général Marocain, with the ERPNext root and account types that reports and defaults rely on. The
accountant reviews it at setup and can add accounts afterwards in ERPNext.

ERPNext's own Moroccan chart (unverified, Kazacube) has no root types and cannot produce a balance sheet.
"""


def _leaf(number: str, account_type: str | None = None) -> dict:
	node: dict = {"account_number": number}
	if account_type:
		node["account_type"] = account_type
	return node


def _group(number: str, children: dict, account_type: str | None = None) -> dict:
	node: dict = {"account_number": number, "is_group": 1, **children}
	if account_type:
		node["account_type"] = account_type
	return node


# VAT account names are referenced by parapilot.setup.defaults.
VAT_COLLECTED = "TVA facturée {rate}%"
VAT_DEDUCTIBLE_GOODS = "TVA récupérable sur achats de marchandises {rate}%"
VAT_DEDUCTIBLE_OVERHEADS = "TVA récupérable sur autres charges {rate}%"

# Small expenses paid from the till during the day (spec 5.8).
PETTY_CASH_ACCOUNT = "Menues dépenses de caisse"

# Write-off reasons (section 5.4): one expense account each, so losses are visible.
WRITE_OFF_ACCOUNTS = {
	"breakage": "Pertes sur stocks - casse",
	"theft": "Pertes sur stocks - vol",
	"expired": "Pertes sur stocks - produits périmés",
	"tester": "Testeurs et échantillons",
}

CHART = {
	"Actif": {
		"root_type": "Asset",
		"Actif immobilisé": _group(
			"2",
			{
				"Immobilisations corporelles": _group(
					"23",
					{
						"Mobilier, matériel de bureau et aménagements divers": _group(
							"235",
							{
								"Mobilier de bureau": _leaf("2351", "Fixed Asset"),
								"Matériel de bureau": _leaf("2352", "Fixed Asset"),
								"Matériel informatique": _leaf("2355", "Fixed Asset"),
								"Agencements, installations et aménagements divers": _leaf("2356", "Fixed Asset"),
							},
						),
						"Immobilisations corporelles en cours": _leaf("2392", "Capital Work in Progress"),
					},
				),
				"Amortissements des immobilisations corporelles": _group(
					"283",
					{
						"Amortissements du mobilier, matériel de bureau et aménagements": _leaf(
							"2835", "Accumulated Depreciation"
						),
					},
				),
			},
		),
		"Actif circulant": _group(
			"3",
			{
				"Stocks": _group(
					"31",
					{"Marchandises": _leaf("3111", "Stock")},
				),
				"Créances de l'actif circulant": _group(
					"34",
					{
						"Fournisseurs débiteurs, avances et acomptes": _leaf("3411"),
						"Clients": _leaf("3421", "Receivable"),
						"Clients douteux ou litigieux": _leaf("3424"),
						"Etat - TVA récupérable": _group(
							"3455",
							{
								"TVA récupérable sur immobilisations": _leaf("34551", "Tax"),
								"TVA récupérable sur charges": _group(
									"34552",
									{
										VAT_DEDUCTIBLE_GOODS.format(rate=20): _leaf("345521", "Tax"),
										VAT_DEDUCTIBLE_GOODS.format(rate=10): _leaf("345522", "Tax"),
										VAT_DEDUCTIBLE_OVERHEADS.format(rate=20): _leaf("345523", "Tax"),
										VAT_DEDUCTIBLE_OVERHEADS.format(rate=10): _leaf("345524", "Tax"),
									},
								),
								"Crédit de TVA (suivant déclaration)": _leaf("34556", "Tax"),
							},
						),
						"Charges constatées d'avance": _leaf("3491"),
					},
				),
			},
		),
		"Trésorerie - actif": _group(
			"5",
			{
				"Chèques et valeurs à encaisser": _group(
					"511",
					{
						"Chèques à encaisser": _leaf("5111"),
						"Paiements par carte à encaisser": _leaf("5118", "Bank"),
					},
				),
				"Banques": _group("514", {"Banque": _leaf("5141", "Bank")}),
				"Caisses": _group("516", {"Caisse": _leaf("5161", "Cash")}),
			},
		),
		"Comptes d'attente": _group(
			"39",
			{"Ouverture temporaire": _leaf("3990", "Temporary")},
		),
	},
	"Passif": {
		"root_type": "Liability",
		"Dettes de financement": _group(
			"14",
			{"Emprunts auprès des établissements de crédit": _leaf("1481")},
		),
		"Passif circulant": _group(
			"4",
			{
				"Fournisseurs et comptes rattachés": _group(
					"441",
					{
						"Fournisseurs": _leaf("4411", "Payable"),
						"Fournisseurs - factures non parvenues": _leaf("4417", "Stock Received But Not Billed"),
					},
				),
				"Clients créditeurs, avances et acomptes": _leaf("4421"),
				"Personnel - rémunérations dues": _leaf("4432"),
				"Organismes sociaux": _group(
					"444",
					{"Caisse Nationale de Sécurité Sociale": _leaf("4441")},
				),
				"Etat créditeur": _group(
					"445",
					{
						"Etat, impôts et taxes à payer": _leaf("4452", "Tax"),
						"Etat, TVA facturée": _group(
							"4455",
							{
								VAT_COLLECTED.format(rate=20): _leaf("44551", "Tax"),
								VAT_COLLECTED.format(rate=10): _leaf("44552", "Tax"),
							},
						),
						"Etat, TVA due (suivant déclarations)": _leaf("4456", "Tax"),
						"Etat, impôts sur les résultats": _leaf("4453", "Tax"),
					},
				),
				"Dettes sur acquisitions d'immobilisations": _leaf("4481"),
			},
		),
	},
	"Capitaux propres": {
		"root_type": "Equity",
		"Capital": _group(
			"111",
			{
				"Capital social ou personnel": _leaf("1111", "Equity"),
				"Compte de l'exploitant": _leaf("1117", "Equity"),
			},
		),
		"Réserve légale": _leaf("1140", "Equity"),
		"Report à nouveau": _leaf("1161", "Equity"),
		"Résultat net de l'exercice": _leaf("1191", "Equity"),
	},
	"Produits": {
		"root_type": "Income",
		"Produits d'exploitation": _group(
			"71",
			{
				"Ventes de marchandises au Maroc": _leaf("7111", "Income Account"),
				"Rabais, remises et ristournes accordés": _leaf("7119", "Income Account"),
				"Autres produits d'exploitation": _leaf("7181", "Income Account"),
			},
		),
		"Produits financiers": _group(
			"73",
			{"Intérêts et autres produits financiers": _leaf("7381", "Income Account")},
		),
		"Produits non courants": _group(
			"75",
			{"Autres produits non courants": _leaf("7588", "Income Account")},
		),
	},
	"Charges": {
		"root_type": "Expense",
		"Charges d'exploitation": _group(
			"61",
			{
				"Achats revendus de marchandises": _group(
					"611",
					{
						"Achats revendus de marchandises": _leaf("6111", "Cost of Goods Sold"),
						"Variation de stocks de marchandises": _leaf("6114", "Stock Adjustment"),
						"Rabais, remises et ristournes obtenus sur achats": _leaf("6119"),
					},
				),
				"Achats consommés de matières et fournitures": _group(
					"612",
					{
						"Emballages et fournitures consommables": _leaf("6123", "Expense Account"),
						"Eau, électricité et carburant": _leaf("6125", "Expense Account"),
					},
				),
				"Autres charges externes": _group(
					"613",
					{
						"Loyer et charges locatives": _leaf("6131", "Expense Account"),
						"Entretien et réparations": _leaf("6133", "Expense Account"),
						"Primes d'assurances": _leaf("6134", "Expense Account"),
						"Honoraires": _leaf("6136", "Expense Account"),
						"Transports sur achats": _leaf("6141", "Expenses Included In Valuation"),
						"Publicité et relations publiques": _leaf("6144", "Expense Account"),
						"Frais postaux et télécommunications": _leaf("6145", "Expense Account"),
						"Services bancaires et commissions carte": _leaf("6147", "Expense Account"),
					},
				),
				"Impôts et taxes": _group(
					"616",
					{
						"Taxe professionnelle et impôts directs": _leaf("6161", "Expense Account"),
						"Droits de timbre et taxes assimilées": _leaf("6167", "Expense Account"),
					},
				),
				"Charges de personnel": _group(
					"617",
					{
						"Rémunérations du personnel": _leaf("6171", "Expense Account"),
						"Charges sociales": _leaf("6174", "Expense Account"),
					},
				),
				"Autres charges d'exploitation": _group(
					"618",
					{
						"Pertes sur créances irrécouvrables": _leaf("6182", "Expense Account"),
						WRITE_OFF_ACCOUNTS["breakage"]: _leaf("61851", "Expense Account"),
						WRITE_OFF_ACCOUNTS["theft"]: _leaf("61852", "Expense Account"),
						WRITE_OFF_ACCOUNTS["expired"]: _leaf("61853", "Expense Account"),
						WRITE_OFF_ACCOUNTS["tester"]: _leaf("61854", "Expense Account"),
						PETTY_CASH_ACCOUNT: _leaf("61857", "Expense Account"),
						"Ecarts de caisse": _leaf("61858", "Expense Account"),
					},
				),
				"Dotations d'exploitation": _group(
					"619",
					{"Dotations aux amortissements": _leaf("6193", "Depreciation")},
				),
			},
		),
		"Charges financières": _group(
			"63",
			{
				"Intérêts des emprunts et dettes": _leaf("6311", "Expense Account"),
				"Pertes de change": _leaf("6331", "Expense Account"),
			},
		),
		"Charges non courantes": _group(
			"65",
			{
				"Valeurs nettes d'amortissements des immobilisations cédées": _leaf("6513", "Expense Account"),
				"Pénalités et amendes fiscales": _leaf("6583", "Expense Account"),
				"Ecarts d'arrondi": _leaf("6588", "Round Off"),
			},
		),
		"Impôts sur les résultats": _group(
			"67",
			{"Impôts sur les bénéfices": _leaf("6701", "Expense Account")},
		),
	},
}
