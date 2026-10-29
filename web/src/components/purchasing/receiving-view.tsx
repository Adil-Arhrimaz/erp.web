"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Camera, CameraOff, Loader2, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFormat } from "@/hooks/use-format";
import { rpc } from "@/lib/api-client";
import type { ReceiptDetail, ReceiptDraft, ReceiptResult, ReceiptRow, ReceivingItem } from "@/lib/purchasing/types";
import { cn } from "@/lib/utils";

import { CameraScanner, cameraScanSupported } from "./camera-scanner";
import { ProductPicker } from "./product-picker";
import { SupplierSelect } from "./supplier-select";
import { TotalsBox } from "./totals-box";

export function ReceivingList({ canReceive }: { canReceive: boolean }) {
  const t = useTranslations("purchasing.receiving");
  const tc = useTranslations("purchasing.common");
  const { money, locale } = useFormat();
  const receipts = useQuery({
    queryKey: ["purchasing", "receipts"],
    queryFn: () => rpc<ReceiptRow[]>("purchasing.list_receipts"),
  });
  const billing = (r: ReceiptRow) =>
    r.docstatus === 2 ? (
      <Badge variant="outline">{t("cancelled")}</Badge>
    ) : r.per_billed >= 100 ? (
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
            <li key={r.name}>
              <Link
                href={`/receiving/${encodeURIComponent(r.name)}`}
                className={cn(
                  "bg-card hover:bg-accent focus-visible:ring-ring flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none",
                  r.docstatus === 2 && "opacity-60",
                )}
              >
                <span className="grid min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium">{r.supplier_name}</span>
                    {r.docstatus === 1 && !r.taxes_and_charges && (
                      <Badge className="bg-warning text-warning-foreground">{t("noVat")}</Badge>
                    )}
                    {r.pp_corrects && <Badge variant="secondary">{t("correction")}</Badge>}
                  </span>
                  <span className="text-muted-foreground num text-xs">
                    {[r.supplier_delivery_note, r.name, new Date(r.posting_date).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB")]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {billing(r)}
                  {r.grand_total !== undefined && (
                    <span className={cn("num text-sm font-semibold", r.docstatus === 2 && "line-through")}>{money(r.grand_total)}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReceiptView({ initial }: { initial: ReceiptDetail }) {
  const t = useTranslations("purchasing.receiving");
  const tc = useTranslations("purchasing.common");
  const queryClient = useQueryClient();
  const { money, locale } = useFormat();
  const [receipt, setReceipt] = useState(initial);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const date = (d: string) => new Date(d).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB");
  const showCosts = receipt.totals !== null;
  const linkTo = (name: string) => (
    <Link className="text-primary font-medium underline-offset-4 hover:underline" href={`/receiving/${encodeURIComponent(name)}`}>
      {name}
    </Link>
  );

  const cancel = async () => {
    setBusy(true);
    try {
      setReceipt(await rpc<ReceiptDetail>("purchasing.cancel_receipt", { name: receipt.name, reason }, true));
      setCancelOpen(false);
      toast.success(t("cancelledToast"));
      await queryClient.invalidateQueries({ queryKey: ["purchasing"] });
      await queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label={tc("back")}>
          <Link href="/receiving">
            <ArrowLeft className="rtl:rotate-180" />
          </Link>
        </Button>
        <div className="grid min-w-0">
          <h2 className="truncate text-xl font-semibold">{receipt.supplier_name}</h2>
          <span className="text-muted-foreground num text-xs">
            {[receipt.supplier_delivery_note, date(receipt.posting_date), receipt.name].filter(Boolean).join(" · ")}
          </span>
        </div>
        {receipt.docstatus === 2 ? (
          <Badge variant="outline">{t("cancelled")}</Badge>
        ) : receipt.invoices.length ? (
          <Badge className="bg-success/15 text-success">{t("billed")}</Badge>
        ) : (
          <Badge variant="secondary">{t("toBill")}</Badge>
        )}
        {receipt.docstatus === 1 && !receipt.vat_included && <Badge className="bg-warning text-warning-foreground">{t("noVat")}</Badge>}
        {receipt.can_correct && (
          <div className="flex w-full gap-2 sm:ms-auto sm:w-auto">
            <Button asChild size="lg" className="flex-1 sm:flex-none">
              <Link href={`/receiving/new?correct=${encodeURIComponent(receipt.name)}`}>
                <Pencil /> {t("correct")}
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="text-destructive flex-1 sm:flex-none" onClick={() => setCancelOpen(true)}>
              <Ban /> {t("cancel")}
            </Button>
          </div>
        )}
      </div>

      {receipt.docstatus === 1 && !receipt.vat_included && (
        <Alert className="border-warning bg-warning/10">
          <TriangleAlert />
          <AlertDescription className="text-foreground">{t("noVatHint")}</AlertDescription>
        </Alert>
      )}
      {(receipt.blocked === "invoiced" || receipt.blocked === "returned") && (
        <Alert>
          <AlertDescription>{t(receipt.blocked === "invoiced" ? "blockedInvoiced" : "blockedReturned")}</AlertDescription>
        </Alert>
      )}
      {receipt.corrected_by && (
        <Alert>
          <AlertDescription>{t.rich("correctedBy", { name: receipt.corrected_by, link: () => linkTo(receipt.corrected_by!) })}</AlertDescription>
        </Alert>
      )}
      {receipt.corrects && (
        <p className="text-muted-foreground text-sm">{t.rich("corrects", { name: receipt.corrects, link: () => linkTo(receipt.corrects!) })}</p>
      )}

      <Card>
        <CardContent className="grid gap-4 pt-6">
          <p className="text-muted-foreground text-sm">
            {t("receivedBy", { name: receipt.received_by })}
            {receipt.warehouse && ` · ${receipt.warehouse}`}
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tc("product")}</TableHead>
                  <TableHead className="text-end">{t("paid")}</TableHead>
                  <TableHead className="text-end">{t("free")}</TableHead>
                  <TableHead className="text-end">{t("damaged")}</TableHead>
                  <TableHead>{t("lot")}</TableHead>
                  <TableHead>{t("expiry")}</TableHead>
                  {showCosts && <TableHead className="text-end">{tc("priceTtc")}</TableHead>}
                  {showCosts && <TableHead className="text-end">{tc("amount")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipt.lines.map((l, i) => (
                  <TableRow key={`${l.item_code}-${i}`}>
                    <TableCell className="font-medium">{l.item_name}</TableCell>
                    <TableCell className="num text-end">{l.qty || ""}</TableCell>
                    <TableCell className="num text-end">{l.free_qty || ""}</TableCell>
                    <TableCell className="num text-end">{l.damaged_qty || ""}</TableCell>
                    <TableCell>{l.lot}</TableCell>
                    <TableCell className="num">{l.expiry_date ? date(l.expiry_date) : ""}</TableCell>
                    {showCosts && <TableCell className="num text-end">{money(l.rate ?? 0)}</TableCell>}
                    {showCosts && <TableCell className="num text-end">{money((l.rate ?? 0) * l.qty)}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {receipt.totals && (
            <div className="sm:ms-auto sm:w-80">
              <TotalsBox totals={receipt.totals} />
            </div>
          )}
        </CardContent>
      </Card>

      {(receipt.invoices.length > 0 || receipt.damage_return) && (
        <Card>
          <CardContent className="grid gap-1 pt-6 text-sm">
            {receipt.invoices.map((name) => (
              <p key={name}>
                {t("invoice")}{" "}
                <Link className="text-primary font-medium underline-offset-4 hover:underline" href={`/supplier-invoices/${encodeURIComponent(name)}`}>
                  {name}
                </Link>
              </p>
            ))}
            {receipt.damage_return && <p>{t("damageReturn", { name: receipt.damage_return })}</p>}
          </CardContent>
        </Card>
      )}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("cancelTitle")}</DialogTitle>
            <DialogDescription>{t("cancelHint")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="cancel-reason">{t("cancelReason")}</FieldLabel>
            <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              {t("keep")}
            </Button>
            <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => void cancel()}>
              {busy && <Loader2 className="animate-spin" />}
              {t("cancelConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

  const correcting = draft.corrects;
  const [supplier, setSupplier] = useState<string | null>(draft.supplier);
  const [deliveryNote, setDeliveryNote] = useState(draft.supplier_delivery_note ?? "");
  const [warehouse, setWarehouse] = useState(draft.warehouse ?? draft.warehouses[0]?.name ?? "");
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Line[]>(
    draft.lines.map((l, i) => ({
      key: l.purchase_order_item ?? `${l.item_code}-${i}`,
      item_code: l.item_code,
      item_name: l.item_name,
      has_batch_no: l.has_batch_no,
      vat_rate: l.vat_rate,
      purchase_order_item: l.purchase_order_item ?? undefined,
      ordered_qty: l.ordered_qty,
      qty: l.qty ? String(l.qty) : "",
      free_qty: l.free_qty ? String(l.free_qty) : "",
      damaged_qty: l.damaged_qty ? String(l.damaged_qty) : "",
      lot: l.lot ?? "",
      expiry_date: l.expiry_date ?? "",
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
    // A lot received earlier may have expired since; the server refuses only a new expired lot.
    if (!correcting && l.expiry_date && l.expiry_date < isoToday()) return "expired";
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
            corrects: correcting,
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
      toast.success(t(correcting ? "corrected" : "submitted"));
      if (result.damage_return) toast.info(t("returnDraft", { name: result.damage_return }), { duration: 8000 });
      await queryClient.invalidateQueries({ queryKey: ["purchasing"] });
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      router.push(correcting ? `/receiving/${encodeURIComponent(result.name)}` : "/receiving");
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
          <Link href={correcting ? `/receiving/${encodeURIComponent(correcting)}` : "/receiving"}>
            <ArrowLeft className="rtl:rotate-180" />
          </Link>
        </Button>
        <h2 className="text-xl font-semibold">{correcting ? t("correctTitle", { name: correcting }) : t("new")}</h2>
        {draft.purchase_order && <Badge variant="secondary">{t("fromOrder", { name: draft.purchase_order })}</Badge>}
      </div>

      {correcting && (
        <Alert>
          <Pencil />
          <AlertDescription>{t("correctHint")}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="supplier">{tc("supplier")}</FieldLabel>
            <SupplierSelect
              id="supplier"
              value={supplier}
              onChange={(s) => setSupplier(s?.name ?? null)}
              disabled={!!draft.purchase_order || !!correcting}
            />
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
                            min={correcting ? undefined : isoToday()}
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
          {t(correcting ? "correctSubmit" : "submit")} · {money(lines.reduce((s, l) => s + num(l.qty) * num(l.rate), 0))}
        </Button>
      </div>
    </div>
  );
}
