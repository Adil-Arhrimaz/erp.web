import { notFound, redirect } from "next/navigation";

import { ProductForm } from "@/components/products/product-form";
import { hasRole } from "@/lib/navigation";
import type { ProductDetail, ProductFormOptions } from "@/lib/types";
import { ErpError, erpCall } from "@/server/erpnext";
import { requireSession } from "@/server/session";

export default async function ProductPage({ params }: PageProps<"/products/[code]">) {
  const { code } = await params;
  const { sid, context } = await requireSession();
  if (!hasRole(context.roles, "owner", "manager", "accountant", "stock_clerk")) redirect("/");

  const [product, options] = await Promise.all([
    erpCall<ProductDetail>(sid, "parapilot.api.catalog.get_product", { item_code: decodeURIComponent(code) }).catch(
      (e) => {
        if (e instanceof ErpError && e.status === 404) return null;
        throw e;
      },
    ),
    erpCall<ProductFormOptions>(sid, "parapilot.api.catalog.get_form_options"),
  ]);
  if (!product) notFound();

  return (
    <ProductForm
      key={product.item_code}
      product={product}
      options={options}
      canEdit={hasRole(context.roles, "owner", "manager")}
    />
  );
}
