"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Plus, ScanBarcode } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFormat } from "@/hooks/use-format";
import { api, rpc } from "@/lib/api-client";
import type { CountResult, CountRow, CountSheetRow, LocationRole } from "@/lib/stock/types";
import type { ProductFormOptions } from "@/lib/types";
import { cn } from "@/lib/utils";

const ALL = "__all__";
const draftKey = (location: string, family: string) => `parapilot:count:${location}:${family}`;
const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function CountsView({ canCount }: { canCount: boolean }) {
  const t = useTranslations("stock.counts");
  const ts = useTranslations("stock");
  const { locale } = useFormat();
  const [starting, setStarting] = useState(false);
  const counts = useQuery({ queryKey: ["stock", "counts"], queryFn: () => rpc<CountRow[]>("stock.list_counts") });

  if (starting) return <CountSetup onCancel={() => setStarting(false)} />;
  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      {canCount && (
        <Button size="lg" className="h-12 sm:justify-self-end" onClick={() => setStarting(true)}>
          <Plus /> {t("new")}
        </Button>
      )}
      {counts.isPending ? (
        <Skeleton className="h-32" />
      ) : !counts.data?.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{ts("empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-2">
          {counts.data.map((c) => (
            <li key={c.name}>
              <Link href={`/stock-count/${encodeURIComponent(c.name)}`} className="bg-card hover:bg-accent flex items-center justify-between gap-3 rounded-xl border p-3">
                <span className="grid">
                  <span className="font-medium">{c.warehouse_role ? ts(`locations.${c.warehouse_role}`) : c.set_warehouse}</span>
                  <span className="text-muted-foreground num text-xs">
                    {c.name} · {new Date(c.posting_date).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB")}
                  </span>
                </span>
                {c.docstatus === 0 ? (
                  <Badge className="bg-warning text-warning-foreground">{t("toApprove")}</Badge>
                ) : (
                  <Badge className="bg-success/15 text-success">{t("approved")}</Badge>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CountSetup({ onCancel }: { onCancel: () => void }) {
  const t = useTranslations("stock.counts");
  const ts = useTranslations("stock");
  const [location, setLocation] = useState<LocationRole>("shop_floor");
  const [family, setFamily] = useState(ALL);
  const [started, setStarted] = useState(false);
  const options = useQuery({ queryKey: ["products", "options"], queryFn: () => api<ProductFormOptions>("/api/products/options") });

  if (started) return <CountSheet location={location} family={family === ALL ? "" : family} onCancel={onCancel} />;
  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>{t("new")}</CardTitle>
        <CardDescription>{t("blindHint")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field>
          <FieldLabel>{t("location")}</FieldLabel>
          <ToggleGroup type="single" variant="outline" value={location} onValueChange={(v) => v && setLocation(v as LocationRole)} className="w-full flex-wrap">
            {(["shop_floor", "back_store", "quarantine"] as const).map((l) => (
              <ToggleGroupItem key={l} value={l} className="h-11 flex-1">
                {ts(`locations.${l}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel>{t("family")}</FieldLabel>
          <Select value={family} onValueChange={setFamily}>
            <SelectTrigger className="h-11 w-full" aria-label={t("family")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("allFamilies")}</SelectItem>
              {options.data?.item_groups.map((g) => (
                <SelectItem key={g.name} value={g.name}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="lg" onClick={onCancel}>
            <ArrowLeft className="rtl:rotate-180" />
          </Button>
          <Button size="lg" onClick={() => setStarted(true)}>
            {t("start")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CountSheet({ location, family, onCancel }: { location: LocationRole; family: string; onCancel: () => void }) {
  const t = useTranslations("stock.counts");
  const ts = useTranslations("stock");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const sheet = useQuery({
    queryKey: ["stock", "count-sheet", location, family],
    queryFn: () => rpc<{ rows: CountSheetRow[] }>("stock.count_sheet", { warehouse_role: location, item_group: family || undefined }),
  });
  const rowKey = (r: CountSheetRow) => `${r.item_code}|${r.batch_no ?? ""}`;

  // A long count survives a closed tab: it is kept on this device until submitted.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(draftKey(location, family));
        if (saved) setCounted(JSON.parse(saved));
      } catch {
        // private browsing: start empty
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [location, family]);
  useEffect(() => {
    try {
      localStorage.setItem(draftKey(location, family), JSON.stringify(counted));
    } catch {
      // ignore
    }
  }, [counted, location, family]);

  const rows = useMemo(() => sheet.data?.rows ?? [], [sheet.data]);
  const q = normalize(query.trim());
  const visible = rows.filter((r) => !q || normalize(r.item_name).includes(q) || r.barcodes.includes(query.trim()) || (r.lot && normalize(r.lot).includes(q)));
  const done = rows.filter((r) => counted[rowKey(r)] !== undefined && counted[rowKey(r)] !== "").length;

  const onScan = () => {
    const code = query.trim();
    const matches = rows.filter((r) => r.barcodes.includes(code));
    if (matches.length === 1) {
      const key = rowKey(matches[0]);
      setCounted((c) => ({ ...c, [key]: String((Number(c[key]) || 0) + 1) }));
      setQuery("");
    } else if (matches.length > 1) {
      inputs.current[rowKey(matches[0])]?.focus();
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const result = await rpc<CountResult>(
        "stock.submit_count",
        {
          warehouse_role: location,
          item_group: family || undefined,
          rows: rows.map((r) => ({ item_code: r.item_code, batch_no: r.batch_no, counted: counted[rowKey(r)] ?? null })),
        },
        true,
      );
      localStorage.removeItem(draftKey(location, family));
      await queryClient.invalidateQueries({ queryKey: ["stock"] });
      if (!result.name) {
        toast.success(t("noDifference"));
        onCancel();
      } else {
        toast.success(t("saved"));
        router.push(`/stock-count/${encodeURIComponent(result.name)}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-3xl gap-3 pb-24">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onCancel} aria-label={ts("tabs.stock")}>
          <ArrowLeft className="rtl:rotate-180" />
        </Button>
        <h2 className="text-lg font-semibold">
          {t("title")} · {ts(`locations.${location}`)}
          {family && ` · ${family}`}
        </h2>
      </div>
      <p className="text-muted-foreground text-sm">{t("blindHint")}</p>
      <div className="bg-background/95 sticky top-14 z-20 grid gap-2 py-2 backdrop-blur">
        <InputGroup className="h-12">
          <InputGroupAddon>
            <ScanBarcode />
          </InputGroupAddon>
          <InputGroupInput
            autoFocus
            type="search"
            placeholder={t("find")}
            aria-label={t("find")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onScan();
              }
            }}
          />
        </InputGroup>
        <div className="flex items-center gap-3 text-xs">
          <Progress value={rows.length ? (done / rows.length) * 100 : 0} className="flex-1" />
          <span className="text-muted-foreground num shrink-0">{t("progress", { counted: done, total: rows.length })}</span>
        </div>
      </div>
      {sheet.isPending ? (
        <Skeleton className="h-48" />
      ) : (
        <ul className="grid gap-1.5">
          {visible.map((r) => {
            const key = rowKey(r);
            const value = counted[key] ?? "";
            return (
              <li key={key} className={cn("bg-card flex items-center gap-3 rounded-lg border p-2 ps-3", value !== "" && "border-success/50 bg-success/5")}>
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">{r.item_name}</span>
                  {r.batch_no && (
                    <span className="text-muted-foreground num text-xs">
                      {ts("lot", { lot: r.lot ?? r.batch_no })}
                      {r.expiry_date && ` · ${r.expiry_date.split("-").reverse().join("/")}`}
                    </span>
                  )}
                </span>
                <Input
                  ref={(el) => {
                    inputs.current[key] = el;
                  }}
                  aria-label={`${r.item_name} ${r.lot ?? ""}`}
                  inputMode="numeric"
                  className="num h-11 w-20 text-center"
                  value={value}
                  onChange={(e) => setCounted((c) => ({ ...c, [key]: e.target.value.replace(/\D/g, "") }))}
                />
              </li>
            );
          })}
        </ul>
      )}
      <div className="bg-background/95 fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
        <Button size="lg" className="h-12 w-full md:ms-auto md:flex md:w-auto" disabled={busy || done === 0} onClick={() => void submit()}>
          {busy && <Loader2 className="animate-spin" />}
          {t("submit")}
        </Button>
      </div>
    </div>
  );
}

export function CountDetail({ initial }: { initial: CountResult }) {
  const t = useTranslations("stock.counts");
  const ts = useTranslations("stock");
  const queryClient = useQueryClient();
  const { money, locale } = useFormat();
  const [count, setCount] = useState(initial);
  const [busy, setBusy] = useState(false);

  const approve = async () => {
    setBusy(true);
    try {
      setCount(await rpc<CountResult>("stock.approve_count", { name: count.name }, true));
      toast.success(t("approvedToast"));
      await queryClient.invalidateQueries({ queryKey: ["stock"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label={t("title")}>
          <Link href="/stock-count">
            <ArrowLeft className="rtl:rotate-180" />
          </Link>
        </Button>
        <div className="grid">
          <h2 className="text-xl font-semibold">
            {t("title")} · {count.warehouse_role && ts(`locations.${count.warehouse_role}`)}
          </h2>
          <span className="text-muted-foreground text-xs">
            {t("countedBy", {
              name: count.counted_by ?? "",
              date: count.posting_date ? new Date(count.posting_date).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB") : "",
            })}
          </span>
        </div>
        {count.docstatus === 0 ? (
          <Badge className="bg-warning text-warning-foreground">{t("toApprove")}</Badge>
        ) : (
          <Badge className="bg-success/15 text-success">{t("approved")}</Badge>
        )}
        {count.can_approve && (
          <Button size="lg" className="ms-auto" disabled={busy} onClick={() => void approve()}>
            {busy && <Loader2 className="animate-spin" />}
            {t("approve")}
          </Button>
        )}
      </div>
      {count.docstatus === 0 && !count.can_approve && (
        <Alert>
          <AlertDescription>{t("managerOnly")}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardContent className="overflow-x-auto pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{ts("product")}</TableHead>
                <TableHead className="text-end">{t("expected")}</TableHead>
                <TableHead className="text-end">{t("counted")}</TableHead>
                <TableHead className="text-end">{t("difference")}</TableHead>
                {count.difference_amount != null && <TableHead className="text-end">{ts("value")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {count.rows?.map((r, i) => (
                <TableRow key={`${r.item_code}-${i}`}>
                  <TableCell>
                    <span className="font-medium">{r.item_name}</span>
                    {r.lot && <span className="text-muted-foreground block text-xs">{ts("lot", { lot: r.lot })}</span>}
                  </TableCell>
                  <TableCell className="num text-end">{r.expected}</TableCell>
                  <TableCell className="num text-end">{r.counted}</TableCell>
                  <TableCell className={cn("num text-end font-semibold", r.difference < 0 ? "text-destructive" : "text-success")}>
                    {r.difference > 0 ? "+" : ""}
                    {r.difference}
                  </TableCell>
                  {count.difference_amount != null && <TableCell className="num text-end">{money(r.amount_difference ?? 0)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {count.difference_amount != null && (
            <p className="num mt-3 text-end text-sm font-semibold">
              {t("differences", { count: count.differences })} · {money(count.difference_amount)}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
