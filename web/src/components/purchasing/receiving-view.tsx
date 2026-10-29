"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, CameraOff, Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFormat } from "@/hooks/use-format";
import { rpc } from "@/lib/api-client";
import type { ReceiptDraft, ReceiptResult, ReceiptRow, ReceivingItem } from "@/lib/purchasing/types";
import { cn } from "@/lib/utils";

import { CameraScanner, cameraScanSupported } from "./camera-scanner";
import { ProductPicker } from "./product-picker";
import { SupplierSelect } from "./supplier-select";

export function ReceivingList({ canReceive }: { canReceive: boolean }) {
  const t = useTranslations("purchasing.receiving");
  const tc = useTranslations("purchasing.common");
  const { money, locale } = useFormat();
  const receipts = useQuery({
    queryKey: ["purchasing", "receipts"],
    queryFn: () => rpc<ReceiptRow[]>("purchasing.list_receipts"),
  });
  const billing = (r: ReceiptRow) =>
    r.per_billed >= 100 ? (
      <Badge className="bg-success/15 text-success">{t("billed")}</Badge>
    ) : r.per_billed > 0 ? (
      <Badge className="bg-warning text-warning-foreground">{t("partlyBilled")}</Badge>
    ) : (
      <Badge variant="secondary">{t("toBill")}</Badge>
    );

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      {canReceive && (
        <Button asChild size="lg" className="h-12 justify-self-stretch sm:justify-self-end">
          <Link href="/receiving/new">
            <Plus /> {t("new")}
          </Link>
        </Button>
      )}
      {receipts.isPending ? (
        <Skeleton className="h-40" />
      ) : !receipts.data?.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{tc("empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-2">
          {receipts.data.map((r) => (
            <li key={r.name} className="bg-card flex items-center justify-between gap-3 rounded-xl border p-3">
              <span className="grid min-w-0">
                <span className="truncate font-medium">{r.supplier_name}</span>
                <span className="text-muted-foreground num text-xs">
                  {[r.supplier_delivery_note, r.name, new Date(r.posting_date).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB")]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {billing(r)}
                {r.grand_total !== undefined && <span className="num text-sm font-semibold">{money(r.grand_total)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Line {
  key: string;
  item_code: string;
  item_name: string;
  has_batch_no: 0 | 1;
  vat_rate: number | null;
  purchase_order_item?: string;
  ordered_qty?: number;
  qty: string;
  free_qty: string;
  damaged_qty: string;
  lot: string;
  expiry_date: string;
  rate: string;
}

const num = (v: string) => Number(v.replace(",", ".")) || 0;
const isoToday = () => new Date().toISOString().slice(0, 10);
const inMonths = (months: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
};

function useCameraSupported() {
  return useSyncExternalStore(
    () => () => undefined,
    cameraScanSupported,
    () => false,
  );
}

export function ReceiptEditor({ draft }: { draft: ReceiptDraft }) {
  const t = useTranslations("purchasing.receiving");
  const tc = useTranslations("purchasing.common");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { money, locale } = useFormat();
  const cameraSupported = useCameraSupported();
  const decimal = (n: number | null) => (n == null ? "" : locale === "fr" ? n.toFixed(2).replace(".", ",") : n.toFixed(2));

  const [supplier, setSupplier] = useState<string | null>(draft.supplier);
  const [deliveryNote, setDeliveryNote] = useState("");
  const [warehouse, setWarehouse] = useState(draft.warehouses[0]?.name ?? "");
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Line[]>(
    draft.lines.map((l) => ({
      key: l.purchase_order_item,
      item_code: l.item_code,
      item_name: l.item_name,
      has_batch_no: l.has_batch_no,
      vat_rate: l.vat_rate,
      purchase_order_item: l.purchase_order_item,
      ordered_qty: l.ordered_qty,
      qty: String(l.qty),
      free_qty: "",
      damaged_qty: "",
      lot: "",
      expiry_date: "",
      rate: decimal(l.rate),
    })),
  );

  const add = (item: ReceivingItem) => {
    const index = lines.findIndex((l) => l.item_code === item.item_code);
    if (index >= 0) {
      setLines((ls) => ls.map((l, i) => (i === index ? { ...l, qty: String(num(l.qty) + 1) } : l)));
      toast.success(`${item.item_name} : ${num(lines[index].qty) + 1}`);
      return;
    }
    setLines((ls) => [
      {
        key: `${item.item_code}-${Date.now()}`,
        item_code: item.item_code,
        item_name: item.item_name,
        has_batch_no: item.has_batch_no,
        vat_rate: item.vat_rate,
        qty: "1",
        free_qty: "",
        damaged_qty: "",
        lot: "",
        expiry_date: "",
        rate: decimal(item.rate),
      },
      ...ls,
    ]);
  };

  const scanCode = async (code: string) => {
    try {
      add(await rpc<ReceivingItem>("purchasing.find_receiving_item", { code }));
    } catch {
      toast.error(tc("unknownBarcode", { code }));
    }
  };

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const lineProblem = (l: Line) => {
    if (l.has_batch_no && num(l.qty) + num(l.free_qty) + num(l.damaged_qty) > 0 && (!l.lot.trim() || !l.expiry_date)) return "lotRequired";
    if (l.expiry_date && l.expiry_date < isoToday()) return "expired";
    return null;
  };
  const blocking = lines.some((l) => lineProblem(l));

  const submit = async () => {
    if (!supplier || blocking) return;
    setBusy(true);
    try {
      const result = await rpc<ReceiptResult>(
        "purchasing.submit_receipt",
        {
          receipt: {
            supplier,
            purchase_order: draft.purchase_order,
            supplier_delivery_note: deliveryNote,
            warehouse,
            lines: lines.map((l) => ({
              item_code: l.item_code,
              purchase_order_item: l.purchase_order_item,
              qty: num(l.qty),
              free_qty: num(l.free_qty),
              damaged_qty: num(l.damaged_qty),
              lot: l.lot,
              expiry_date: l.expiry_date || null,
              rate: num(l.rate),
            })),
          },
        },
        true,
      );
      toast.success(t("submitted"));
      if (result.damage_return) toast.info(t("returnDraft", { name: result.damage_return }), { duration: 8000 });
      await queryClient.invalidateQueries({ queryKey: ["purchasing"] });
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      router.push("/receiving");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-4xl gap-4 pb-24">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label={tc("back")}>
          <Link href="/receiving">
            <ArrowLeft className="rtl:rotate-180" />
          </Link>
        </Button>
        <h2 className="text-xl font-semibold">{t("new")}</h2>
        {draft.purchase_order && <Badge variant="secondary">{t("fromOrder", { name: draft.purchase_order })}</Badge>}
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="supplier">{tc("supplier")}</FieldLabel>
            <SupplierSelect id="supplier" value={supplier} onChange={(s) => setSupplier(s?.name ?? null)} disabled={!!draft.purchase_order} />
          </Field>
          <Field>
            <FieldLabel htmlFor="bl">{t("deliveryNote")}</FieldLabel>
            <Input id="bl" className="h-10" value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel>{t("warehouse")}</FieldLabel>
            <ToggleGroup type="single" variant="outline" value={warehouse} onValueChange={(v) => v && setWarehouse(v)} className="w-full">
              {draft.warehouses.map((w) => (
                <ToggleGroupItem key={w.name} value={w.name} className="h-11 flex-1">
                  {t(w.role)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        </CardContent>
      </Card>

      <div className="grid gap-2">
        <p className="text-muted-foreground text-sm font-medium">{t("scan")}</p>
        <div className="flex gap-2">
          <div className="flex-1">
            <ProductPicker onPick={add} autoFocus />
          </div>
          {cameraSupported && (
            <Button variant="outline" size="icon" className="size-12" onClick={() => setCamera((c) => !c)} aria-label={camera ? t("closeCamera") : t("camera")}>
              {camera ? <CameraOff /> : <Camera />}
            </Button>
          )}
        </div>
        {camera && <CameraScanner onCode={(code) => void scanCode(code)} />}
      </div>

      <ul className="grid gap-3" aria-label={t("lines", { count: lines.length })}>
        {lines.map((l) => {
          const problem = lineProblem(l);
          const short = !problem && l.expiry_date && l.expiry_date < inMonths(6);
          return (
            <li key={l.key}>
              <Card className={cn(problem && "border-destructive")}>
                <CardContent className="grid gap-3 pt-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="grid">
                      <span className="font-medium">{l.item_name}</span>
                      {l.ordered_qty !== undefined && (
                        <span className="text-muted-foreground text-xs">{t("ordered", { qty: l.ordered_qty })}</span>
                      )}
                    </span>
                    <Button variant="ghost" size="icon" className="size-10" aria-label={tc("remove")} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(["qty", "free_qty", "damaged_qty"] as const).map((field) => (
                      <Field key={field}>
                        <FieldLabel htmlFor={`${l.key}-${field}`} className="text-xs">
                          {t(field === "qty" ? "paid" : field === "free_qty" ? "free" : "damaged")}
                        </FieldLabel>
                        <Input
                          id={`${l.key}-${field}`}
                          inputMode="numeric"
                          className="num h-11"
                          value={l[field]}
                          onChange={(e) => update(l.key, { [field]: e.target.value.replace(/[^\d]/g, "") })}
                        />
                      </Field>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {l.has_batch_no === 1 && (
                      <>
                        <Field>
                          <FieldLabel htmlFor={`${l.key}-lot`} className="text-xs">
                            {t("lot")}
                          </FieldLabel>
                          <Input id={`${l.key}-lot`} className="h-11" value={l.lot} onChange={(e) => update(l.key, { lot: e.target.value })} />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor={`${l.key}-exp`} className="text-xs">
                            {t("expiry")}
                          </FieldLabel>
                          <Input
                            id={`${l.key}-exp`}
                            type="date"
                            min={isoToday()}
                            className="h-11"
                            value={l.expiry_date}
                            onChange={(e) => update(l.key, { expiry_date: e.target.value })}
                          />
                        </Field>
                      </>
                    )}
                    <Field>
                      <FieldLabel htmlFor={`${l.key}-rate`} className="text-xs">
                        {tc("priceTtc")}
                      </FieldLabel>
                      <Input id={`${l.key}-rate`} inputMode="decimal" className="num h-11" value={l.rate} onChange={(e) => update(l.key, { rate: e.target.value })} />
                    </Field>
                  </div>
                  {problem && (
                    <p className="text-destructive flex items-center gap-1.5 text-xs">
                      <TriangleAlert className="size-3.5" /> {t(problem)}
                    </p>
                  )}
                  {short && (
                    <p className="text-warning-foreground bg-warning/20 flex items-center gap-1.5 rounded px-2 py-1 text-xs">
                      <TriangleAlert className="size-3.5" /> {t("shortExpiry")}
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      {blocking && (
        <Alert variant="destructive">
          <AlertDescription>{t("lotRequired")}</AlertDescription>
        </Alert>
      )}

      <div className="bg-background/95 fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
        <Button size="lg" className="h-12 w-full md:ms-auto md:flex md:w-auto" disabled={busy || !supplier || !lines.length || blocking} onClick={() => void submit()}>
          {busy && <Loader2 className="animate-spin" />}
          {t("submit")} · {money(lines.reduce((s, l) => s + num(l.qty) * num(l.rate), 0))}
        </Button>
      </div>
    </div>
  );
}
