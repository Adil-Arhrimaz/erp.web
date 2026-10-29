import { NextResponse } from "next/server";

import { erpCall } from "@/server/erpnext";
import { withSession } from "@/server/session";

/**
 * The parapilot methods the browser may call through the ParaPilot server, and how. Anything not listed
 * is refused here; ERPNext still checks the person's permissions on every call.
 */
const METHODS: Record<string, "GET" | "POST"> = {
  "pos.search_customers": "GET",
  "pos.create_business_customer": "POST",
  "pos.record_cash_out": "POST",
  "purchasing.list_suppliers": "GET",
  "purchasing.get_supplier": "GET",
  "purchasing.save_supplier": "POST",
  "purchasing.list_purchase_orders": "GET",
  "purchasing.get_purchase_order": "GET",
  "purchasing.suggest_order_lines": "GET",
  "purchasing.save_purchase_order": "POST",
  "purchasing.submit_purchase_order": "POST",
  "purchasing.list_receipts": "GET",
  "purchasing.get_receipt_draft": "GET",
  "purchasing.find_receiving_item": "GET",
  "purchasing.submit_receipt": "POST",
  "purchasing.list_invoices": "GET",
  "purchasing.open_receipts": "GET",
  "purchasing.preview_invoice": "GET",
  "purchasing.overhead_items": "GET",
  "purchasing.save_invoice": "POST",
  "purchasing.submit_invoice": "POST",
  "purchasing.get_invoice": "GET",
  "purchasing.payment_modes": "GET",
  "purchasing.check_cash_limit": "GET",
  "purchasing.pay_invoice": "POST",
  "stock.stock_overview": "GET",
  "stock.expiry_board": "GET",
  "stock.item_batches": "GET",
  "stock.transfer": "POST",
  "stock.write_off": "POST",
  "stock.count_sheet": "GET",
  "stock.submit_count": "POST",
  "stock.list_counts": "GET",
  "stock.get_count": "GET",
  "stock.approve_count": "POST",
  "returns.set_my_pin": "POST",
  "returns.my_pin_status": "GET",
  "returns.find_sale": "GET",
  "returns.submit_return": "POST",
  "returns.list_supplier_returns": "GET",
  "returns.submit_supplier_return": "POST",
  "returns.receipt_lines": "GET",
  "returns.create_supplier_return": "POST",
  "returns.create_debit_note": "POST",
  "customers.search": "GET",
  "customers.create": "POST",
  "customers.list_customers": "GET",
  "customers.history": "GET",
  "customers.set_consent": "POST",
  "vat.periods": "GET",
  "vat.summary": "GET",
  "reports.run": "GET",
  "settings.get_all": "GET",
  "settings.create_shop": "POST",
  "settings.save_company": "POST",
  "settings.save_settings": "POST",
  "settings.confirm_vat": "POST",
  "settings.set_family": "POST",
  "settings.mark_step": "POST",
  "settings.create_till": "POST",
  "settings.list_users": "GET",
  "settings.invite_user": "POST",
  "settings.update_user": "POST",
  "settings.import_products": "POST",
};

type Ctx = { params: Promise<{ method: string }> };

function resolve(method: string, httpMethod: "GET" | "POST") {
  const allowed = METHODS[method];
  return allowed === httpMethod ? `parapilot.api.${method}` : null;
}

export const GET = withSession(async (sid, request, { params }: Ctx) => {
  const target = resolve((await params).method, "GET");
  if (!target) return NextResponse.json({ error: { message: "Not found." } }, { status: 404 });
  const args = Object.fromEntries(new URL(request.url).searchParams);
  return NextResponse.json(await erpCall(sid, target, args));
});

export const POST = withSession(async (sid, request, { params }: Ctx) => {
  const target = resolve((await params).method, "POST");
  if (!target) return NextResponse.json({ error: { message: "Not found." } }, { status: 404 });
  const args = (await request.json().catch(() => null)) ?? {};
  if (typeof args !== "object" || Array.isArray(args)) {
    return NextResponse.json({ error: { message: "Invalid request." } }, { status: 400 });
  }
  return NextResponse.json(await erpCall(sid, target, args, "POST"));
});
