import { NextResponse } from "next/server";
import { productInputSchema } from "@/lib/schemas";
import type { ProductList, SaveProductResult } from "@/lib/types";
import { erpCall } from "@/server/erpnext";
import { withSession } from "@/server/session";

export const GET = withSession(async (sid, request) => {
  const params = new URL(request.url).searchParams;
  const list = await erpCall<ProductList>(sid, "parapilot.api.catalog.list_products", {
    search: params.get("search") ?? undefined,
    item_group: params.get("item_group") ?? undefined,
    brand: params.get("brand") ?? undefined,
    status: params.get("status") ?? "active",
    start: Number(params.get("start") ?? 0),
    page_length: 50,
  });
  return NextResponse.json(list);
});

export const POST = withSession(async (sid, request) => {
  const parsed = productInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: "Invalid product.", issues: parsed.error.issues } },
      { status: 400 },
    );
  }
  const result = await erpCall<SaveProductResult>(
    sid,
    "parapilot.api.catalog.save_product",
    { product: parsed.data },
    "POST",
  );
  return NextResponse.json(result);
});
