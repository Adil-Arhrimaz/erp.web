/** Product import spreadsheet: the template ParaPilot hands out and the CSV it reads back. */

export const TEMPLATE_HEADERS = ["nom", "marque", "laboratoire", "famille", "code_barres", "prix_ttc", "stock_min", "suivi_lots"];
const KEYS: Record<string, string> = {
  nom: "name",
  name: "name",
  marque: "brand",
  brand: "brand",
  laboratoire: "lab",
  lab: "lab",
  famille: "family",
  family: "family",
  code_barres: "barcode",
  barcode: "barcode",
  prix_ttc: "price_ttc",
  price_ttc: "price_ttc",
  stock_min: "min_stock",
  min_stock: "min_stock",
  suivi_lots: "batch_tracking",
  batch_tracking: "batch_tracking",
};

/** CSV as Excel saves it in France (;) or elsewhere (,), with quoted fields. */
export function parseCsv(content: string): Record<string, string>[] {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (quoted) {
      if (ch === '"' && content[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && content[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!header) return [];
  const keys = header.map((h) => KEYS[h.trim().toLowerCase().replace(/^﻿/, "")] ?? h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}
