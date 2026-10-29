import { z } from "zod";

/** A sale as the till sends it; parapilot.api.pos.submit_sale validates it again. */
export const saleSchema = z.object({
  client_id: z.string().regex(/^[0-9A-Z]{10,26}$/),
  pos_profile: z.string().min(1),
  sold_at: z.string().min(1),
  customer: z.string().min(1).optional(),
  lines: z
    .array(
      z.object({
        item_code: z.string().min(1),
        qty: z.number().positive(),
        price: z.number().positive(),
        rate: z.number().nonnegative(),
      }),
    )
    .min(1),
  payments: z.array(z.object({ mode_of_payment: z.string().min(1), amount: z.number().nonnegative() })),
});
