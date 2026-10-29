import { NextResponse } from "next/server";

import { erpDownload } from "@/server/erpnext";
import { withSession } from "@/server/session";

/** Excel exports the browser may download, passed through from ERPNext. */
const EXPORTS: Record<string, string> = {
  vat: "parapilot.api.vat.export",
  report: "parapilot.api.reports.export",
};

export const GET = withSession(async (sid, request, { params }: { params: Promise<{ method: string }> }) => {
  const target = EXPORTS[(await params).method];
  if (!target) return NextResponse.json({ error: { message: "Not found." } }, { status: 404 });
  const upstream = await erpDownload(sid, target, Object.fromEntries(new URL(request.url).searchParams));
  const disposition = upstream.headers.get("Content-Disposition") ?? "attachment";
  // Frappe sends files as octet-stream; name the type so phones open Excel files in the right app.
  const type = /\.xlsx/i.test(disposition)
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : (upstream.headers.get("Content-Type") ?? "application/octet-stream");
  return new Response(upstream.body, { headers: { "Content-Type": type, "Content-Disposition": disposition } });
});
