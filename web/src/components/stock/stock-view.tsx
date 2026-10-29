"use client";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFormat } from "@/hooks/use-format";
import { rpc } from "@/lib/api-client";
import type { ExpiryBatch, ExpiryBoard, StockRow } from "@/lib/stock/types";
import { cn } from "@/lib/utils";

type Tab = "stock" | "expiry" | "low";

export function ExpiryBadge({ batch }: { batch: Pick<ExpiryBatch, "days_left" | "bucket"> }) {
  const t = useTranslations("stock");
  const label =
    batch.days_left < 0 ? t("expiredSince", { days: -batch.days_left }) : t("expiresIn", { days: batch.days_left });
  return (
    <Badge
      variant={batch.bucket === "expired" ? "destructive" : "secondary"}
      className={cn(batch.bucket === "30" && "bg-warning text-warning-foreground", batch.bucket === "60" && "bg-warning/40")}
    >
      {label}
    </Badge>
  );
}

export function StockView({ canWriteOff, initialTab = "stock" }: { canWriteOff: boolean; initialTab?: Tab }) {
  const t = useTranslations("stock");
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <ToggleGroup type="single" variant="outline" value={tab} onValueChange={(v) => v && setTab(v as Tab)} className="justify-start">
        {(["stock", "expiry", "low"] as const).map((v) => (
          <ToggleGroupItem key={v} value={v} className="h-10 px-4">
            {t(`tabs.${v}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {tab === "expiry" ? <ExpiryPanel canWriteOff={canWriteOff} /> : <StockPanel lowOnly={tab === "low"} />}
    </div>
  );
}

function StockPanel({ lowOnly }: { lowOnly: boolean }) {
  const t = useTranslations("stock");
  const { money, qty } = useFormat();
  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search.trim());
  const data = useQuery({
    queryKey: ["stock", "overview", deferred, lowOnly],
    queryFn: () => rpc<{ items: StockRow[]; show_costs: boolean }>("stock.stock_overview", { search: deferred, low_only: lowOnly ? 1 : 0 }),
  });
  const rows = data.data?.items ?? [];
  const showCosts = data.data?.show_costs;
  const total = (r: StockRow) => r.shop_floor + r.back_store;

  return (
    <div className="grid gap-3">
      <InputGroup className="h-11 sm:max-w-sm">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput type="search" placeholder={t("search")} aria-label={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} />
      </InputGroup>
      {data.isPending ? (
        <Skeleton className="h-48" />
      ) : rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{t("empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <ul className="grid gap-2 md:hidden">
            {rows.map((r) => (
              <li key={r.item_code} className="bg-card grid gap-1 rounded-xl border p-3">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{r.item_name}</span>
                  <span className="num font-semibold">{qty(total(r))}</span>
                </span>
                <span className="text-muted-foreground num flex flex-wrap gap-x-3 text-xs">
                  <span>
                    {t("locations.shop_floor")} {qty(r.shop_floor)}
                  </span>
                  <span>
                    {t("locations.back_store")} {qty(r.back_store)}
                  </span>
                  {r.quarantine > 0 && (
                    <span>
                      {t("locations.quarantine")} {qty(r.quarantine)}
                    </span>
                  )}
                </span>
                {r.low && <Badge className="bg-warning text-warning-foreground justify-self-start">{t("low")}</Badge>}
              </li>
            ))}
          </ul>
          <div className="bg-card hidden overflow-hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("product")}</TableHead>
                  <TableHead className="text-end">{t("locations.shop_floor")}</TableHead>
                  <TableHead className="text-end">{t("locations.back_store")}</TableHead>
                  <TableHead className="text-end">{t("locations.quarantine")}</TableHead>
                  <TableHead className="text-end">{t("min")}</TableHead>
                  {showCosts && <TableHead className="text-end">{t("value")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.item_code}>
                    <TableCell className="w-full max-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{r.item_name}</span>
                        {r.low && <Badge className="bg-warning text-warning-foreground">{t("low")}</Badge>}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">{[r.brand, r.item_group].filter(Boolean).join(" · ")}</span>
                    </TableCell>
                    <TableCell className="num text-end">{qty(r.shop_floor)}</TableCell>
                    <TableCell className="num text-end">{qty(r.back_store)}</TableCell>
                    <TableCell className={cn("num text-end", r.quarantine > 0 && "text-destructive")}>{qty(r.quarantine)}</TableCell>
                    <TableCell className="num text-muted-foreground text-end">{r.min_stock || ""}</TableCell>
                    {showCosts && <TableCell className="num text-end whitespace-nowrap">{money(r.value ?? 0)}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

function ExpiryPanel({ canWriteOff }: { canWriteOff: boolean }) {
  const t = useTranslations("stock");
  const { money, qty, locale } = useFormat();
  const board = useQuery({ queryKey: ["stock", "expiry"], queryFn: () => rpc<ExpiryBoard>("stock.expiry_board", { days: 90 }) });
  const buckets = ["expired", "30", "60", "90"] as const;

  if (board.isPending) return <Skeleton className="h-48" />;
  const data = board.data!;
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {buckets.map((b) => {
          const total = data.totals[b];
          return (
            <Card key={b} className={cn(b === "expired" && total && "border-destructive")}>
              <CardContent className="grid gap-1 pt-4">
                <span className="text-muted-foreground text-sm">{t(`buckets.${b}`)}</span>
                <span className="num text-xl font-semibold">{total ? t("bucketSummary", { batches: total.batches, qty: total.qty }) : "–"}</span>
                {data.show_costs && total && <span className="num text-muted-foreground text-xs">{money(total.value)}</span>}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {data.batches.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{t("noExpiry")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-2">
          {data.batches.map((b) => (
            <li key={`${b.batch_no}-${b.warehouse}`} className="bg-card flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border p-3">
              <span className="grid min-w-0 flex-1">
                <span className="truncate font-medium">{b.item_name}</span>
                <span className="text-muted-foreground num text-xs">
                  {t("lot", { lot: b.lot })} · {new Date(b.expiry_date).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB")} ·{" "}
                  {t(`locations.${b.warehouse}`)}
                </span>
              </span>
              <ExpiryBadge batch={b} />
              <span className="num w-16 text-end font-semibold">{qty(b.qty)}</span>
              {data.show_costs && <span className="num text-muted-foreground w-24 text-end text-sm">{money(b.value ?? 0)}</span>}
              {canWriteOff && b.bucket === "expired" && (
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={`/transfers?mode=write_off&reason=expired&item=${encodeURIComponent(b.item_code)}&batch=${encodeURIComponent(b.batch_no)}&qty=${b.qty}&from=${b.warehouse}`}
                  >
                    {t("writeOff")}
                  </Link>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
