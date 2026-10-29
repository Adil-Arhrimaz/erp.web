"use client";

import { useLocale } from "next-intl";
import { useMemo } from "react";

import { formatMoney, formatPercent, toCents } from "@/lib/money";

/** Formatting in the person's language: 1 234,50 DH in French, 1,234.50 DH in English. */
export function useFormat() {
  const locale = useLocale();
  return useMemo(
    () => ({
      locale,
      money: (amount: number) => formatMoney(toCents(amount), locale),
      moneyCents: (cents: number) => formatMoney(cents, locale),
      percent: (rate: number | null, digits?: number) => formatPercent(rate, locale, digits),
      qty: (n: number) => new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US").format(n),
    }),
    [locale],
  );
}
