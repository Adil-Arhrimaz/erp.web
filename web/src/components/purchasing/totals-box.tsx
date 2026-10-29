"use client";

import { useTranslations } from "next-intl";

import { useFormat } from "@/hooks/use-format";
import type { Totals } from "@/lib/purchasing/types";

export function TotalsBox({ totals }: { totals: Totals }) {
  const t = useTranslations("purchasing.common");
  const { money } = useFormat();
  return (
    <dl className="num grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
      <dt className="text-muted-foreground">{t("totalHt")}</dt>
      <dd className="text-end">{money(totals.ht)}</dd>
      {totals.vat_by_rate.map((r) => (
        <div key={r.rate} className="contents">
          <dt className="text-muted-foreground">{r.rate ? t("vatRate", { rate: r.rate }) : t("exempt")}</dt>
          <dd className="text-end">{money(r.vat)}</dd>
        </div>
      ))}
      <dt className="pt-1 text-base font-semibold">{t("totalTtc")}</dt>
      <dd className="pt-1 text-end text-lg font-bold" data-testid="doc-total">
        {money(totals.ttc)}
      </dd>
    </dl>
  );
}
