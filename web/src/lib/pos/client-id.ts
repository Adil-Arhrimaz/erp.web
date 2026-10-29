const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U

/**
 * A sale ID made on the device before ERPNext sees the sale: 10 characters of time (ms) and 6 random,
 * so IDs sort by time and two tills cannot collide. ERPNext stores it as a unique field, which makes
 * sending a sale twice harmless. It is also the barcode on the receipt.
 */
export function newClientId(now = Date.now()): string {
  let time = "";
  for (let n = now, i = 0; i < 10; i++, n = Math.floor(n / 32)) time = ALPHABET[n % 32] + time;
  const random = crypto.getRandomValues(new Uint8Array(6));
  return time + Array.from(random, (b) => ALPHABET[b % 32]).join("");
}
