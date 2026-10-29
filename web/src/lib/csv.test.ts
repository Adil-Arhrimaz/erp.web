import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("reads French Excel CSV (;, BOM, decimal comma) with French headers", () => {
    const rows = parseCsv("﻿nom;marque;famille;code_barres;prix_ttc\r\nCrème 50 ml;Marque A;Visage;6111000000014;189,00\r\n");
    expect(rows).toEqual([{ name: "Crème 50 ml", brand: "Marque A", family: "Visage", barcode: "6111000000014", price_ttc: "189,00" }]);
  });

  it("reads comma CSV with quoted fields and English headers", () => {
    const rows = parseCsv('name,family,price_ttc\n"Gel, 200 ml",Visage,"129.00"\n\n');
    expect(rows).toEqual([{ name: "Gel, 200 ml", family: "Visage", price_ttc: "129.00" }]);
  });
});
