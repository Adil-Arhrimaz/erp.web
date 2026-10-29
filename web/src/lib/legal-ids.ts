/** Moroccan legal identifiers and product barcodes. Mirrors parapilot/validations on the server. */

/** Strip the spaces, dots and dashes people type when copying an ICE from paper. */
export function normalizeIce(value: string): string {
  return value.replace(/[\s.\-]/g, "");
}

/** ICE (Identifiant Commun de l'Entreprise): exactly 15 digits. */
export function isValidIce(value: string): boolean {
  return /^\d{15}$/.test(normalizeIce(value));
}

export function ean13CheckDigit(first12: string): number {
  const sum = [...first12].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** Thirteen digits must be a valid EAN-13; other codes (internal, UPC) are accepted as typed. */
export function isAcceptableBarcode(code: string): boolean {
  return /^\d{13}$/.test(code) ? isValidEan13(code) : code.trim().length > 0;
}
