"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Printer, TrendingDown, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFormat } from "@/hooks/use-format";
import { api, rpc } from "@/lib/api-client";
import type { ProductFormOptions } from "@/lib/types";
import { cn } from "@/lib/utils";

type ReportKey =
  | "daily_summary"
  | "monthly_sales"
  | "best_sellers"
  | "margins"
  | "slow_movers"
  | "expiry"
  | "stock_value"
  | "purchases_by_supplier";

const COST_REPORTS: ReportKey[] = ["margins", "stock_value"];
const MONEY = new Set([
  "amount",
  "ht",
  "ttc",
  "vat",
  "margin",
  "cost",
  "value",
  "received_ttc",
  "to_invoice_ttc",
  "invoiced_ht",
  "invoiced_vat",
  "invoiced_ttc",
]);
const DATES = new Set(["last_sale", "expiry_date"]);
const ALL = "__all__";

interface ReportResult {
  rows: Record<string, string | number | null>[];
  columns: string[];
  kpis?: Record<string, number | null | Record<string, number>>;
  series?: { date: string; ttc: number }[];
  brands?: { brand: string; ttc?: number; value?: number }[];
  locations?: { location: string; value: number }[];
  filters: Record<string, string | null>;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function presets() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    today: [iso(now), iso(now)],
    thisMonth: [iso(first), iso(now)],
    lastMonth: [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))],
    thisYear: [iso(new Date(now.getFullYear(), 0, 1)), iso(now)],
  } as const;
}

export function ReportsView({ canSeeCosts }: { canSeeCosts: boolean }) {
  const t = useTranslations("reports");
  const [report, setReport] = useState<ReportKey | null>(null);
  const available = (Object.keys(t.raw("list")) as ReportKey[]).filter((k) => canSeeCosts || !COST_REPORTS.includes(k));

  if (report) return <ReportPanel report={report} onBack={() => setReport(null)} canSeeCosts={canSeeCosts} />;
  return (
    <div className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {available.map((key) => {
        const [title, question] = t.raw(`list.${key}`) as [string, string];
        return (
          <button
            key={key}
            type="button"
            onClick={() => setReport(key)}
            className="bg-card hover:bg-accent focus-visible:ring-ring grid gap-1 rounded-xl border p-4 text-start focus-visible:ring-2 focus-visible:outline-none"
          >
            <span className="font-semibold">{title}</span>
            <span className="text-muted-foreground text-sm">{question}</span>
          </button>
        );
      })}
    </div>
  );
}

function ReportPanel({ report, onBack, canSeeCosts }: { report: ReportKey; onBack: () => void; canSeeCosts: boolean }) {
  const t = useTranslations("reports");
  const ts = useTranslations("stock");
  const { money, percent, qty, locale } = useFormat();
  const [range, setRange] = useState<readonly [string, string]>(presets().thisMonth);
  const [preset, setPreset] = useState("thisMonth");
  const [family, setFamily] = useState(ALL);
  const [brand, setBrand] = useState(ALL);
  const [days, setDays] = useState("60");
  const [sortBy, setSortBy] = useState("qty");
  const [groupBy, setGroupBy] = useState("item_group");
  const options = useQuery({ queryKey: ["products", "options"], queryFn: () => api<ProductFormOptions>("/api/products/options") });

  const single = report === "daily_summary" || report === "monthly_sales";
  const noPeriod = report === "slow_movers" || report === "expiry" || report === "stock_value";
  const filters = {
    from_date: single ? range[1] : range[0],
    to_date: range[1],
    item_group: family === ALL ? undefined : family,
    brand: brand === ALL ? undefined : brand,
    days: report === "slow_movers" ? days : report === "expiry" ? "90" : undefined,
    sort_by: report === "best_sellers" ? sortBy : undefined,
    group_by: report === "margins" ? groupBy : undefined,
  };
  const data = useQuery({
    queryKey: ["reports", report, filters],
    queryFn: () => rpc<ReportResult>("reports.run", { report, filters }),
  });
  const [title, question] = t.raw(`list.${report}`) as [string, string];
  const date = (d: string) => new Date(d).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB");

  const cell = (column: string, value: string | number | null) => {
    if (value === null || value === undefined || value === "") return column === "last_sale" ? t("never") : "";
    if (MONEY.has(column)) return money(Number(value));
    if (column === "margin_rate") return percent(Number(value));
    if (column === "qty" || column === "invoices") return qty(Number(value));
    if (DATES.has(column)) return date(String(value));
    if (column === "location") return ts(`locations.${value}`);
    return String(value);
  };

  const kpiLabels = t.raw("kpis") as Record<string, string>;
  const kpis = Object.entries(data.data?.kpis ?? {}).filter(([k, v]) => typeof v === "number" && k in kpiLabels);
  const exportHref = `/api/export/report?${new URLSearchParams({ report, filters: JSON.stringify(filters) })}`;
  const chartConfig = { ttc: { label: t("kpis.ttc"), color: "var(--chart-1)" } } satisfies ChartConfig;

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label={t("title")}>
          <ArrowLeft className="rtl:rotate-180" />
        </Button>
        <div className="grid">
          <h2 className="text-xl font-semibold">{title}</h2>
          <span className="text-muted-foreground text-sm">{question}</span>
        </div>
        <div className="flex gap-2 sm:ms-auto">
          <Button asChild variant="outline">
            <a href={exportHref} download>
              <Download /> {t("export")}
            </a>
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer /> {t("print")}
          </Button>
        </div>
      </div>

      <div className="no-print flex flex-wrap items-end gap-2">
        {!noPeriod &&
          (single ? (
            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">{report === "daily_summary" ? t("filters.day") : t("filters.month")}</span>
              <Input
                type={report === "daily_summary" ? "date" : "month"}
                className="h-10 w-44"
                value={report === "daily_summary" ? range[1] : range[1].slice(0, 7)}
                onChange={(e) => {
                  const v = report === "daily_summary" ? e.target.value : `${e.target.value}-01`;
                  if (v) setRange([v, v]);
                }}
              />
            </label>
          ) : (
            <>
              <ToggleGroup
                type="single"
                variant="outline"
                value={preset}
                onValueChange={(v) => {
                  if (!v) return;
                  setPreset(v);
                  setRange(presets()[v as keyof ReturnType<typeof presets>]);
                }}
              >
                {(["today", "thisMonth", "lastMonth", "thisYear"] as const).map((p) => (
                  <ToggleGroupItem key={p} value={p} className="h-10 px-3">
                    {t(`filters.${p}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{t("filters.from")}</span>
                <Input type="date" className="h-10 w-40" value={range[0]} onChange={(e) => { setPreset(""); setRange([e.target.value, range[1]]); }} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{t("filters.to")}</span>
                <Input type="date" className="h-10 w-40" value={range[1]} onChange={(e) => { setPreset(""); setRange([range[0], e.target.value]); }} />
              </label>
            </>
          ))}
        {report !== "purchases_by_supplier" && report !== "daily_summary" && report !== "expiry" && (
          <>
            <FilterSelect label={t("filters.family")} value={family} onChange={setFamily} options={options.data?.item_groups.map((g) => g.name) ?? []} all={t("filters.all")} />
            <FilterSelect label={t("filters.brand")} value={brand} onChange={setBrand} options={options.data?.brands ?? []} all={t("filters.all")} />
          </>
        )}
        {report === "slow_movers" && (
          <ToggleGroup type="single" variant="outline" value={days} onValueChange={(v) => v && setDays(v)} aria-label={t("filters.days")}>
            {["60", "90"].map((d) => (
              <ToggleGroupItem key={d} value={d} className="h-10 px-3">
                {d} j
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        {report === "best_sellers" && (
          <ToggleGroup type="single" variant="outline" value={sortBy} onValueChange={(v) => v && setSortBy(v)} aria-label={t("filters.sortBy")}>
            {(canSeeCosts ? ["qty", "ht", "margin"] : ["qty", "ht"]).map((k) => (
              <ToggleGroupItem key={k} value={k} className="h-10 px-3">
                {t(`sort.${k}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        {report === "margins" && (
          <ToggleGroup type="single" variant="outline" value={groupBy} onValueChange={(v) => v && setGroupBy(v)} aria-label={t("filters.groupBy")}>
            {["item_group", "brand", "item_name"].map((k) => (
              <ToggleGroupItem key={k} value={k} className="h-10 px-3">
                {t(`group.${k}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>

      {data.isPending ? (
        <Skeleton className="h-72" />
      ) : (
        <div className="print-area grid gap-4">
          <h2 className="hidden text-lg font-semibold print:block">
            {title} · {noPeriod ? date(range[1]) : single ? date(range[1]) : `${date(range[0])} – ${date(range[1])}`}
          </h2>
          {kpis.length > 0 && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
              {kpis.map(([k, v]) => (
                <Card key={k}>
                  <CardContent className="grid gap-1 pt-4">
                    <span className="text-muted-foreground text-xs">{t(`kpis.${k}`)}</span>
                    <span className="num text-lg font-semibold">
                      {k === "tickets" || k === "items" ? qty(Number(v)) : k === "margin_rate" ? percent(Number(v)) : money(Number(v))}
                    </span>
                  </CardContent>
                </Card>
              ))}
              {report === "monthly_sales" && (
                <Trend label={t("kpis.previous_ttc")} change={data.data?.kpis?.vs_previous as number | null} />
              )}
              {report === "monthly_sales" && (
                <Trend label={t("kpis.last_year_ttc")} change={data.data?.kpis?.vs_last_year as number | null} />
              )}
            </div>
          )}

          {data.data?.series && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("byDay")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
                  <BarChart data={data.data.series} margin={{ left: 0, right: 0 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tickFormatter={(d: string) => d.slice(8)} interval="preserveStartEnd" />
                    <ChartTooltip content={<ChartTooltipContent labelFormatter={(d) => date(String(d))} formatter={(v) => money(Number(v))} />} />
                    <Bar dataKey="ttc" fill="var(--color-ttc)" radius={4} isAnimationActive={false} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}

          {!data.data?.rows.length ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyDescription>{t("empty")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Card>
              <CardContent className="overflow-x-auto pt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {data.data.columns.map((c) => (
                        <TableHead key={c} className={cn(c !== data.data!.columns[0] && "text-end")}>
                          {t(`columns.${c}`)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.rows.map((row, i) => (
                      <TableRow key={i}>
                        {data.data!.columns.map((c, j) => (
                          <TableCell key={c} className={cn(j > 0 && "num text-end whitespace-nowrap", j === 0 && "font-medium", c === "margin" && Number(row[c]) < 0 && "text-destructive")}>
                            {cell(c, row[c])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {data.data?.locations && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("byLocation")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1 text-sm">
                {data.data.locations.map((l) => (
                  <p key={l.location} className="flex justify-between">
                    <span>{ts(`locations.${l.location}`)}</span>
                    <span className="num">{money(l.value)}</span>
                  </p>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, all }: { label: string; value: string; onChange: (v: string) => void; options: string[]; all: string }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-10 w-44" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{all}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function Trend({ label, change }: { label: string; change: number | null | undefined }) {
  const { percent } = useFormat();
  if (change === null || change === undefined) return null;
  const up = change >= 0;
  return (
    <Card>
      <CardContent className="grid gap-1 pt-4">
        <span className="text-muted-foreground text-xs">{label}</span>
        <span className={cn("num flex items-center gap-1 text-lg font-semibold", up ? "text-success" : "text-destructive")}>
          {up ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
          {up ? "+" : ""}
          {percent(change)}
        </span>
      </CardContent>
    </Card>
  );
}
