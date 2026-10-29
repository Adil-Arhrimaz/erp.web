"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, PackageCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormat } from "@/hooks/use-format";
import { rpc } from "@/lib/api-client";
import { documentTotals, fromCents, toCents } from "@/lib/money";
import type { OrderSuggestion, PurchaseOrder, PurchaseOrderRow, ReceivingItem, Totals } from "@/lib/purchasing/types";

import { PageToolbar } from "./page-toolbar";
import { ProductPicker } from "./product-picker";
import { SupplierSelect } from "./supplier-select";
import { TotalsBox } from "./totals-box";

type Tab = "all" | "draft" | "to_receive" | "received";

export function OrderStatus({ order }: { order: Pick<PurchaseOrderRow, "docstatus" | "per_received"> }) {
  const t = useTranslations("purchasing.orders.status");
  if (order.docstatus === 0) return <Badge variant="outline">{t("draft")}</Badge>;
  if (order.per_received >= 100) return <Badge className="bg-success/15 text-success">{t("received")}</Badge>;
  if (order.per_received > 0) return <Badge className="bg-warning text-warning-foreground">{t("partly")}</Badge>;
  return <Badge variant="secondary">{t("toReceive")}</Badge>;
}

export function OrdersView({ canCreate }: { canCreate: boolean }) {
  const t = useTranslations("purchasing.orders");
  const tc = useTranslations("purchasing.common");
  const { money, locale } = useFormat();
  const [tab, setTab] = useState<Tab>("all");
  const orders = useQuery({
    queryKey: ["purchasing", "orders", tab],
    queryFn: () => rpc<PurchaseOrderRow[]>("purchasing.list_purchase_orders", { status: tab === "all" ? undefined : tab }),
  });
  const date = (d: string) => new Date(d).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB");

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <PageToolbar
        tabs={(["all", "draft", "to_receive", "received"] as const).map((v) => ({ value: v, label: t(`tabs.${v}`) }))}
        value={tab}
        onChange={setTab}
        newHref={canCreate ? "/purchase-orders/new" : undefined}
        newLabel={t("new")}
      />
      {orders.isPending ? (
        <Skeleton className="h-40" />
      ) : !orders.data?.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{tc("empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-2">
          {orders.data.map((o) => (
            <li key={o.name}>
              <Link
                href={`/purchase-orders/${encodeURIComponent(o.name)}`}
                className="bg-card hover:bg-accent grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-xl border p-3 sm:grid-cols-[1fr_auto_auto_auto]"
              >
                <span className="grid min-w-0">
                  <span className="truncate font-medium">{o.supplier_name}</span>
                  <span className="text-muted-foreground num text-xs">
                    {o.name} · {date(o.transaction_date)}
                  </span>
                </span>
                <span className="justify-self-end">
                  <OrderStatus order={o} />
                </span>
                <span className="text-muted-foreground hidden text-xs sm:block">
                  {o.schedule_date && t("expected", { date: date(o.schedule_date) })}
                </span>
                <span className="num col-start-2 justify-self-end font-semibold sm:col-start-auto">{money(o.grand_total)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Line {
  item_code: string;
  item_name: string;
  qty: string;
  rate: string;
  vat_rate: number | null;
  received_qty?: number;
}

const num = (v: string) => Number(v.replace(",", ".")) || 0;

export function OrderEditor({ order, canSubmitRole }: { order: PurchaseOrder | null; canSubmitRole: boolean }) {
  const t = useTranslations("purchasing.orders");
  const tc = useTranslations("purchasing.common");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { money, locale } = useFormat();
  const decimal = (n: number | null) => (n == null ? "" : locale === "fr" ? n.toFixed(2).replace(".", ",") : n.toFixed(2));
  const [supplier, setSupplier] = useState<string | null>(order?.supplier ?? null);
  const [lines, setLines] = useState<Line[]>(
    order?.lines.map((l) => ({
      item_code: l.item_code,
      item_name: l.item_name,
      qty: String(l.qty),
      rate: decimal(l.rate),
      vat_rate: l.vat_rate,
      received_qty: l.received_qty,
    })) ?? [],
  );
  const [saved, setSaved] = useState<PurchaseOrder | null>(order);
  const [busy, setBusy] = useState(false);
  const readOnly = !!saved && saved.docstatus !== 0;

  const suggestions = useQuery({
    queryKey: ["purchasing", "suggestions", supplier],
    queryFn: () => rpc<OrderSuggestion[]>("purchasing.suggest_order_lines", { supplier }),
    enabled: !!supplier && !order,
  });

  const chooseSupplier = async (name: string | null) => {
    setSupplier(name);
    if (!name || order) return;
    const list = await queryClient.fetchQuery({
      queryKey: ["purchasing", "suggestions", name],
      queryFn: () => rpc<OrderSuggestion[]>("purchasing.suggest_order_lines", { supplier: name }),
    });
    setLines(
      list
        .filter((s) => s.suggested_qty > 0)
        .map((s) => ({ item_code: s.item_code, item_name: s.item_name, qty: String(s.suggested_qty), rate: decimal(s.rate), vat_rate: s.vat_rate })),
    );
  };

  const add = (item: { item_code: string; item_name: string; rate: number | null; vat_rate: number | null }, qty = 1) =>
    setLines((ls) =>
      ls.some((l) => l.item_code === item.item_code)
        ? ls.map((l) => (l.item_code === item.item_code ? { ...l, qty: String(num(l.qty) + qty) } : l))
        : [...ls, { item_code: item.item_code, item_name: item.item_name, qty: String(qty), rate: decimal(item.rate), vat_rate: item.vat_rate }],
    );

  const preview: Totals = (() => {
    const totals = documentTotals(lines.map((l) => ({ unitTtc: toCents(num(l.rate)), qty: num(l.qty), vatRate: l.vat_rate ?? 0 })));
    return {
      ht: fromCents(totals.ht),
      vat: fromCents(totals.vat),
      ttc: fromCents(totals.ttc),
      vat_by_rate: totals.byRate.map((r) => ({ rate: r.vatRate, ht: fromCents(r.ht), vat: fromCents(r.vat) })),
    };
  })();

  const save = async (submit: boolean) => {
    if (!supplier) return;
    setBusy(true);
    try {
      let result = await rpc<PurchaseOrder>(
        "purchasing.save_purchase_order",
        {
          order: {
            name: saved?.name,
            supplier,
            lines: lines.map((l) => ({ item_code: l.item_code, qty: num(l.qty), rate: num(l.rate) })),
          },
        },
        true,
      );
      if (submit) result = await rpc<PurchaseOrder>("purchasing.submit_purchase_order", { name: result.name }, true);
      setSaved(result);
      toast.success(submit ? t("submitted") : t("draftSaved"));
      await queryClient.invalidateQueries({ queryKey: ["purchasing", "orders"] });
      if (!order) router.replace(`/purchase-orders/${encodeURIComponent(result.name)}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const suggestionsLeft = (suggestions.data ?? []).filter((s) => !lines.some((l) => l.item_code === s.item_code));

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label={tc("back")}>
          <Link href="/purchase-orders">
            <ArrowLeft className="rtl:rotate-180" />
          </Link>
        </Button>
        <h2 className="text-xl font-semibold">{saved ? saved.name : t("new")}</h2>
        {saved && <OrderStatus order={saved} />}
        {saved && saved.docstatus === 1 && saved.per_received < 100 && (
          <Button asChild className="ms-auto">
            <Link href={`/receiving/new?po=${encodeURIComponent(saved.name)}`}>
              <PackageCheck /> {t("receive")}
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6">
          <Field>
            <FieldLabel htmlFor="supplier">{tc("supplier")}</FieldLabel>
            <SupplierSelect id="supplier" value={supplier} onChange={(s) => void chooseSupplier(s?.name ?? null)} disabled={readOnly || !!saved} />
          </Field>
          {!readOnly && supplier && <ProductPicker onPick={(item: ReceivingItem) => add(item)} />}
          {lines.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {lines.map((l, i) => (
                <li key={l.item_code} className="grid grid-cols-[1fr_auto] items-center gap-2 p-3 sm:grid-cols-[1fr_6rem_8rem_7rem_auto]">
                  <span className="col-span-2 grid min-w-0 sm:col-span-1">
                    <span className="truncate font-medium">{l.item_name}</span>
                    {readOnly && l.received_qty !== undefined && (
                      <span className="text-muted-foreground num text-xs">{t("received", { received: l.received_qty, qty: l.qty })}</span>
                    )}
                  </span>
                  <Input
                    aria-label={tc("qty")}
                    inputMode="numeric"
                    className="num h-11"
                    value={l.qty}
                    disabled={readOnly}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                  />
                  <Input
                    aria-label={tc("priceTtc")}
                    inputMode="decimal"
                    className="num h-11"
                    value={l.rate}
                    disabled={readOnly}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))}
                  />
                  <span className="num text-end text-sm font-medium">{money(num(l.qty) * num(l.rate))}</span>
                  {!readOnly && (
                    <Button variant="ghost" size="icon" className="size-11" aria-label={tc("remove")} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                      <Trash2 />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {lines.length > 0 && (
            <div className="sm:ms-auto sm:w-80">
              <TotalsBox totals={saved && readOnly ? saved.totals : preview} />
            </div>
          )}
        </CardContent>
      </Card>

      {!readOnly && supplier && !order && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("suggestions")}</CardTitle>
            <CardDescription>{t("suggestionsHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            {suggestions.isPending ? (
              <Skeleton className="h-16" />
            ) : !suggestions.data?.length ? (
              <p className="text-muted-foreground text-sm">{t("noSuggestions")}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {suggestionsLeft.map((s) => (
                  <li key={s.item_code}>
                    <Button variant="outline" className="h-auto min-h-11 flex-col items-start py-1.5" onClick={() => add(s)}>
                      <span>{s.item_name}</span>
                      <span className="text-muted-foreground text-xs font-normal">{t("stock", { stock: s.stock, min: s.min_stock })}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {!readOnly && (
        <>
          {!canSubmitRole && <Alert><AlertDescription>{t("draftOnly")}</AlertDescription></Alert>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="lg" disabled={busy || !supplier || !lines.length} onClick={() => void save(false)}>
              {busy && <Loader2 className="animate-spin" />}
              {t("saveDraft")}
            </Button>
            {canSubmitRole && (
              <Button size="lg" disabled={busy || !supplier || !lines.length} onClick={() => void save(true)}>
                {t("submit")}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
