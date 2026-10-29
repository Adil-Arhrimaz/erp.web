import { redirect } from "next/navigation";

import { ProductForm } from "@/components/products/product-form";
import { hasRole } from "@/lib/navigation";
import type { ProductFormOptions } from "@/lib/types";
import { erpCall } from "@/server/erpnext";
import { requireSession } from "@/server/session";

export default async function NewProductPage() {
  const { sid, context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager")) redirect("/products");
  const options = await erpCall<ProductFormOptions>(sid, "parapilot.api.catalog.get_form_options");
  return <ProductForm product={null} options={options} canEdit />;
}
