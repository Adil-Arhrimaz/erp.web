"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, Download, Printer, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/hooks/use-format";
import { rpc } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface VatSummary {
  period: { start: string; end: string; kind: "Monthly" | "Quarterly" };
  basis: "Cash" | "Invoice";
  collected: { rate: number; ht: number; vat: number }[];
  collected_total: number;
  deductible_goods: number;
  deductible_overheads: number;
  cash_vat_lost: number;
  credit_in: number;
  payable: number;
  credit_out: number;
  deadline: string;
  days_to_deadline: number;
  zero_declaration: boolean;
  ledger: { collected: number; deductible_recorded: number };
  checks: {
    items_without_vat: { item_code: string; item_name: string }[];
    invoices_without_ice: { name: string; supplier: string; bill_no: string | null }[];
    cash_over_limits: { supplier: string; date: string; payment: string; over: number; vat_lost: number }[];
    unpaid_invoices: { name: string; supplier: string; bill_no: string | null; outstanding: number; vat_waiting: number }[];
  };
}

export function VatView() {
  const t = useTranslations("vat");
  const { money, locale } = useFormat();
  const [start, setStart] = useState<string | null>(null);
  const periods = useQuery({ queryKey: ["vat", "periods"], queryFn: () => rpc<{ start: string; end: string }[]>("vat.periods") });
  const current = start ?? periods.data?.[0]?.start ?? null;
  const summary = useQuery({
    queryKey: ["vat", "summary", current],
    queryFn: () => rpc<VatSummary>("vat.summary", { start: current }),
    enabled: !!current,
  });
  const date = (d: string) => new Date(d).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB");
  const label = (p: { start: string; end: string }) => `${date(p.start)} – ${date(p.end)}`;
  const s = summary.data;
  const checks = s?.checks;
  const checkCount = checks
    ? checks.items_without_vat.length + checks.invoices_without_ice.length + checks.cash_over_limits.length + checks.unpaid_invoices.length
    : 0;

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        <Select value={current ?? ""} onValueChange={setStart}>
          <SelectTrigger className="h-11 w-full sm:w-72" aria-label={t("period")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periods.data?.map((p) => (
              <SelectItem key={p.start} value={p.start}>
                {label(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2 sm:ms-auto">
          <Button asChild variant="outline" disabled={!current}>
            <a href={`/api/export/vat?start=${current ?? ""}`} download>
              <Download /> {t("export")}
            </a>
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer /> {t("print")}
          </Button>
        </div>
      </div>

      {!s ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="print-area grid gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold">
              {t("title")} · {label(s.period)}
            </h2>
            <span className="text-muted-foreground text-sm">
              {t(s.period.kind === "Monthly" ? "monthly" : "quarterly")} · {t(`basis.${s.basis}`)}
            </span>
          </div>

          <Alert className={cn(s.days_to_deadline < 0 ? "border-destructive" : s.days_to_deadline <= 7 && "border-warning bg-warning/10")}>
            <CalendarClock />
            <AlertDescription className="text-foreground">
              {t("deadline", { date: date(s.deadline) })} ·{" "}
              <strong>{s.days_to_deadline < 0 ? t("late", { days: -s.days_to_deadline }) : t("daysLeft", { days: s.days_to_deadline })}</strong>
            </AlertDescription>
          </Alert>
          {s.zero_declaration && (
            <Alert>
              <TriangleAlert />
              <AlertDescription>{t("zero")}</AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("collected")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("rate")}</TableHead>
                    <TableHead className="text-end">{t("base")}</TableHead>
                    <TableHead className="text-end">{t("vat")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.collected.map((c) => (
                    <TableRow key={c.rate}>
                      <TableCell>{c.rate ? `${c.rate} %` : t("exempt")}</TableCell>
                      <TableCell className="num text-end">{money(c.ht)}</TableCell>
                      <TableCell className="num text-end">{money(c.vat)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <dl className="num grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
                <dt>{t("collectedTotal")}</dt>
                <dd className="text-end font-medium">{money(s.collected_total)}</dd>
                <dt>{t("deductibleGoods")}</dt>
                <dd className="text-end">− {money(s.deductible_goods)}</dd>
                <dt>{t("deductibleOverheads")}</dt>
                <dd className="text-end">− {money(s.deductible_overheads)}</dd>
                {s.cash_vat_lost > 0 && (
                  <>
                    <dt className="text-destructive">{t("cashLost")}</dt>
                    <dd className="text-destructive text-end">+ {money(s.cash_vat_lost)}</dd>
                  </>
                )}
                <dt>{t("creditIn")}</dt>
                <dd className="text-end">− {money(s.credit_in)}</dd>
                <dt className="border-t pt-2 text-lg font-semibold">{s.credit_out > 0 ? t("creditOut") : t("payable")}</dt>
                <dd className="border-t pt-2 text-end text-2xl font-bold" data-testid="vat-result">
                  {money(s.credit_out > 0 ? s.credit_out : s.payable)}
                </dd>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("ledger")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <p className="flex justify-between gap-4">
                <span>{t("ledgerCollected")}</span>
                <span className="num">
                  {money(s.ledger.collected)}{" "}
                  {Math.abs(s.ledger.collected - s.collected_total) < 0.005 && <CheckCircle2 className="text-success inline size-4" aria-label={t("ledgerMatch")} />}
                </span>
              </p>
              <p className="flex justify-between gap-4">
                <span>{t("ledgerDeductible")}</span>
                <span className="num">{money(s.ledger.deductible_recorded)}</span>
              </p>
              <p className="text-muted-foreground text-xs">{t("ledgerNote")}</p>
            </CardContent>
          </Card>

          <Card className={cn(checkCount > 0 && "border-warning")}>
            <CardHeader>
              <CardTitle className="text-base">{t("checks")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              {checkCount === 0 && (
                <p className="text-success flex items-center gap-2">
                  <CheckCircle2 className="size-4" /> {t("checksOk")}
                </p>
              )}
              {checks!.items_without_vat.length > 0 && (
                <CheckList title={t("itemsWithoutVat", { count: checks!.items_without_vat.length })}>
                  {checks!.items_without_vat.map((i) => (
                    <li key={i.item_code}>
                      <Link className="underline" href={`/products/${encodeURIComponent(i.item_code)}`}>
                        {i.item_name}
                      </Link>
                    </li>
                  ))}
                </CheckList>
              )}
              {checks!.invoices_without_ice.length > 0 && (
                <CheckList title={t("invoicesWithoutIce", { count: checks!.invoices_without_ice.length })}>
                  {checks!.invoices_without_ice.map((i) => (
                    <li key={i.name}>
                      <Link className="underline" href={`/supplier-invoices/${encodeURIComponent(i.name)}`}>
                        {i.supplier} · {i.bill_no ?? i.name}
                      </Link>
                    </li>
                  ))}
                </CheckList>
              )}
              {checks!.cash_over_limits.length > 0 && (
                <CheckList title={t("cashOverLimits", { count: checks!.cash_over_limits.length })}>
                  {checks!.cash_over_limits.map((c) => (
                    <li key={c.payment}>
                      {c.supplier} · {date(c.date)} · {t("over", { amount: money(c.over), vat: money(c.vat_lost) })}
                    </li>
                  ))}
                </CheckList>
              )}
              {checks!.unpaid_invoices.length > 0 && (
                <CheckList title={t("unpaid", { count: checks!.unpaid_invoices.length })}>
                  {checks!.unpaid_invoices.map((u) => (
                    <li key={u.name}>
                      <Link className="underline" href={`/supplier-invoices/${encodeURIComponent(u.name)}`}>
                        {u.supplier} · {u.bill_no ?? u.name}
                      </Link>{" "}
                      · <span className="num">{money(u.outstanding)}</span> · {t("vatWaiting", { amount: money(u.vat_waiting) })}
                    </li>
                  ))}
                </CheckList>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function CheckList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-1">
      <h3 className="flex items-center gap-2 font-medium">
        <TriangleAlert className="text-warning-foreground size-4" /> {title}
      </h3>
      <ul className="text-muted-foreground grid gap-0.5 ps-6">{children}</ul>
    </section>
  );
}
