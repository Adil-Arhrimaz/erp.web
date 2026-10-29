import { NextResponse } from "next/server";

import type { ProductFormOptions } from "@/lib/types";
import { erpCall } from "@/server/erpnext";
import { withSession } from "@/server/session";

export const GET = withSession(async (sid) =>
  NextResponse.json(await erpCall<ProductFormOptions>(sid, "parapilot.api.catalog.get_form_options")),
);
