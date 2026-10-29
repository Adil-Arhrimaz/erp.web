import { z } from "zod";

import { isAcceptableBarcode } from "./legal-ids";

/** Product rules shared by the form and the server route; ERPNext validates again on save. */
export const productInputSchema = z.object({
  item_code: z.string().optional(),
  item_name: z.string().trim().min(1).max(140),
  item_group: z.string().min(1),
  brand: z.string().trim().nullish(),
  pp_lab: z.string().trim().nullish(),
  barcodes: z.array(z.string().trim().refine(isAcceptableBarcode)).max(20),
  price_ttc: z.number().nonnegative().nullish(),
  has_batch_no: z.boolean().optional(),
  pp_min_stock: z.number().nonnegative().nullish(),
  pp_is_tester: z.boolean().optional(),
  default_supplier: z.string().nullish(),
  disabled: z.boolean().optional(),
});
