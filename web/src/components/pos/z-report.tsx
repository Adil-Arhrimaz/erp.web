"use client";

import { useTranslations } from "next-intl";

import { useFormat } from "@/hooks/use-format";
import type { ZReport } from "@/lib/pos/types";
import { cn } from "@/lib/utils";

/** End-of-day report (Z), printable on the 80 mm receipt printer. */
export function ZReportView({ report }: { report: ZReport }) {
  const t = useTranslations("till.z");
  const tt = useTranslations("till");
  const { money, locale } = useFormat();
  const when = (s: string) =>
    new Date(s.replace(" ", "T")).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", {
      dateStyle: "short",
      timeStyle: "short",
    });
  const c = report.company;

  return (
    <div className="mx-auto w-[72mm] bg-white p-3 font-mono text-[11px] leading-snug text-black">
      <header className="mb-2 text-center">
        <p className="text-sm font-bold">{c.name}</p>
        {c.ice && <p>ICE {c.ice}</p>}
        <p className="mt-1 text-sm font-bold">
          {t("title")} · {report.pos_profile}
        </p>
        <p>{report.name}</p>
        <p>{t("period", { start: when(report.period_start), end: when(report.period_end) })}</p>
        <p>{t("cashier", { name: report.cashier })}</p>
      </header>

      <Section title={t("sales")}>
        <Row label={t("tickets")} value={String(report.tickets)} />
        <Row label={t("totalHt")} value={money(report.net_total)} />
        <Row label={t("vat")} value={money(report.vat_total)} />
        <Row label={t("totalTtc")} value={money(report.grand_total)} strong />
        <Row label={t("discounts")} value={money(report.discounts)} />
        <Row label={`${t("returns")} (${report.returns.count})`} value={money(report.returns.total)} />
      </Section>

      <Section title={t("vatByRate")}>
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-start font-normal">{t("rate")}</th>
              <th className="text-end font-normal">{t("base")}</th>
              <th className="text-end font-normal">{t("vat")}</th>
            </tr>
          </thead>
          <tbody>
            {report.vat_by_rate.map((r) => (
              <tr key={r.rate}>
                <td>{r.rate} %</td>
                <td className="text-end">{money(r.ht)}</td>
                <td className="text-end">{money(r.vat)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={t("payments")}>
        {report.payments.map((p) => (
          <div key={p.mode_of_payment} className="mb-1">
            <p className="font-bold">{p.mode_of_payment}</p>
            {p.opening > 0 && <Row label={t("opening")} value={money(p.opening)} />}
            <Row label={tt("expected")} value={money(p.expected)} />
            <Row label={tt("counted")} value={money(p.counted)} />
            <Row label={tt("difference")} value={`${p.difference > 0 ? "+" : ""}${money(p.difference)}`} strong={p.difference !== 0} />
          </div>
        ))}
      </Section>

      {report.cash_outs.length > 0 && (
        <Section title={tt("zCashOuts")}>
          {report.cash_outs.map((c) => (
            <Row key={c.name} label={c.reason} value={`−${money(c.amount)}`} />
          ))}
        </Section>
      )}

      {report.price_reviews.length > 0 && (
        <Section title={t("priceReviews")}>
          {report.price_reviews.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </Section>
      )}
      <p className="mt-2 text-center">{t("locked")}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-dashed border-black py-1">
      <p className="font-bold uppercase">{title}</p>
      {children}
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className={cn("flex justify-between gap-2", strong && "font-bold")}>
      <span>{label}</span>
      <span>{value}</span>
    </p>
  );
}
