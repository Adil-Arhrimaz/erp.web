"use client";

import JsBarcode from "jsbarcode";
import { createTranslator } from "next-intl";
import { useEffect, useMemo, useRef } from "react";

import { formatAmount, toCents } from "@/lib/money";
import type { Receipt as ReceiptData } from "@/lib/pos/types";
import { cn } from "@/lib/utils";
import en from "../../../messages/en/receipt.json";
import fr from "../../../messages/fr/receipt.json";

/**
 * 80 mm receipt (CGI art. 145): seller identity and legal IDs, number, lines, VAT by rate, totals and
 * payment. It follows the company's receipt language, not the cashier's, because the customer reads it.
 */
export function Receipt({
  receipt,
  language,
  className,
}: {
  receipt: ReceiptData;
  language: "fr" | "en";
  className?: string;
}) {
  const t = useMemo(
    () =>
      createTranslator({ locale: language, messages: { receipt: language === "en" ? en : fr }, namespace: "receipt" }),
    [language],
  );
  const amount = (n: number) => formatAmount(toCents(n), language);
  const barcode = useRef<SVGSVGElement>(null);

  // The device sale ID; returns are made on the server, so they carry the invoice number instead.
  const code = receipt.client_id || receipt.name || "";

  useEffect(() => {
    if (barcode.current && code) {
      JsBarcode(barcode.current, code, {
        format: "CODE128",
        height: 36,
        width: 1.4,
        margin: 0,
        fontSize: 11,
        displayValue: true,
      });
    }
  }, [code]);

  const c = receipt.company;
  const ids = c
    ? (["ice", "if", "rc", "tp"] as const).filter((k) => c[k]).map((k) => `${t(k)} ${c[k]}`)
    : [];
  const [y, m, d] = receipt.posting_date.split("-");

  return (
    <div
      className={cn(
        "receipt mx-auto w-[72mm] bg-white p-3 font-mono text-[11px] leading-snug text-black",
        className,
      )}
    >
      {c && (
        <header className="mb-2 text-center">
          <p className="text-sm font-bold">{c.name}</p>
          {c.address && <p>{c.address}</p>}
          {c.phone && <p>{c.phone}</p>}
          {ids.length > 0 && <p>{ids.join(" · ")}</p>}
        </header>
      )}
      <div className="border-y border-dashed border-black py-1">
        <p className={receipt.customer?.ice || receipt.is_return ? "font-bold" : undefined}>
          {receipt.name
            ? `${receipt.is_return ? t("refund") : receipt.customer?.ice ? t("invoice") : t("ticket")} ${receipt.name}`
            : t("provisional")}
        </p>
        <p>
          {t("date")} {d}/{m}/{y} {receipt.posting_time.slice(0, 5)} · {t("cashier")} {receipt.cashier}
        </p>
        {receipt.customer && (
          <div className="mt-1">
            <p>
              {t("customer")} : {receipt.customer.name}
            </p>
            {receipt.customer.address && <p>{receipt.customer.address}</p>}
            {receipt.customer.ice && (
              <p>
                {t("ice")} {receipt.customer.ice}
              </p>
            )}
          </div>
        )}
      </div>

      <table className="my-1 w-full">
        <tbody>
          {receipt.lines.map((l, i) => (
            <tr key={`${l.item_code}-${i}`} className="align-top">
              <td className="py-0.5 pe-1">
                {l.item_name}
                <br />
                <span>
                  {l.qty} × {amount(l.price)}
                  {l.discount_percent > 0.001 && ` · ${t("discount", { percent: Number(l.discount_percent.toFixed(2)) })}`}
                </span>
              </td>
              <td className="py-0.5 text-end whitespace-nowrap">{amount(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-t border-dashed border-black pt-1">
        <Row label={t("totalHt")} value={amount(receipt.totals.ht)} />
        <Row label={t("totalVat")} value={amount(receipt.totals.vat)} />
        <Row label={`${t("totalTtc")} (${t("currency")})`} value={amount(receipt.totals.ttc)} strong />
        {!!receipt.totals.rounding && (
          <>
            <Row label={t("rounding")} value={amount(receipt.totals.rounding)} />
            <Row label={`${t("due")} (${t("currency")})`} value={amount(receipt.totals.due ?? receipt.totals.ttc)} strong />
          </>
        )}
      </div>

      <table className="mt-1 w-full border-t border-dashed border-black">
        <thead>
          <tr>
            <th className="text-start font-normal" />
            <th className="text-end font-normal">{t("base")}</th>
            <th className="text-end font-normal">{t("vat")}</th>
          </tr>
        </thead>
        <tbody>
          {receipt.vat_by_rate.map((r) => (
            <tr key={r.rate}>
              <td>{r.rate ? t("vatRate", { rate: r.rate }) : t("exempt")}</td>
              <td className="text-end">{amount(r.ht)}</td>
              <td className="text-end">{amount(r.vat)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-1 border-t border-dashed border-black pt-1">
        {receipt.payments.map((p) => (
          <Row key={p.mode_of_payment} label={p.mode_of_payment} value={amount(p.amount)} />
        ))}
        {receipt.change > 0 && <Row label={t("change")} value={amount(receipt.change)} strong />}
        {receipt.is_return === 1 && <p className="mt-1 text-center font-bold">{t("refunded")}</p>}
        {receipt.totals.discount > 0 && (
          <p className="mt-1 text-center">{t("savings", { amount: `${amount(receipt.totals.discount)} ${t("currency")}` })}</p>
        )}
      </div>

      <div className="mt-2 flex flex-col items-center gap-1">
        {code && <svg ref={barcode} aria-label={code} />}
        <p>{t("thanks")}</p>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className={cn("flex justify-between gap-2", strong && "text-sm font-bold")}>
      <span>{label}</span>
      <span>{value}</span>
    </p>
  );
}

/** Prints only the element marked .print-area, sized for an 80 mm thermal printer. */
export function printReceipt() {
  window.print();
}
