import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";

export function VatBadge({ rate }: { rate: number | null | undefined }) {
  const t = useTranslations("common");
  const tp = useTranslations("products");
  if (rate === null || rate === undefined) return <Badge variant="destructive">{tp("noVat")}</Badge>;
  return <Badge variant="secondary">{rate === 0 ? t("vatExempt") : t("vatRate", { rate })}</Badge>;
}
