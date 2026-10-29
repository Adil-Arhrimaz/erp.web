"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Minus, Plus, Printer, ScanBarcode, Truck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Receipt, printReceipt } from "@/components/pos/receipt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFormat } from "@/hooks/use-format";
import { ApiError, rpc } from "@/lib/api-client";
import { fromCents, toCents } from "@/lib/money";
import type { Receipt as ReceiptData } from "@/lib/pos/types";
import type { ReceiptRow } from "@/lib/purchasing/types";
import type { SaleToReturn, SupplierReturnRow } from "@/lib/stock/types";

type Tab = "customer" | "supplier";

export function ReturnsView({
  canCustomer,
  canSupplier,
  receiptLanguage,
}: {
  canCustomer: boolean;
  canSupplier: boolean;
  receiptLanguage: "fr" | "en";
}) {
  const t = useTranslations("returns");
  // Stock clerks handle supplier returns only (spec, section 3).
  const [tab, setTab] = useState<Tab>(canCustomer ? "customer" : "supplier");
  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      {canSupplier && canCustomer && (
        <ToggleGroup type="single" variant="outline" value={tab} onValueChange={(v) => v && setTab(v as Tab)} className="w-full">
          <ToggleGroupItem value="customer" className="h-11 flex-1">
            {t("tabs.customer")}
          </ToggleGroupItem>
          <ToggleGroupItem value="supplier" className="h-11 flex-1">
            {t("tabs.supplier")}
          </ToggleGroupItem>
        </ToggleGroup>
      )}
      {tab === "customer" ? <CustomerReturn receiptLanguage={receiptLanguage} /> : <SupplierReturns />}
    </div>
  );
}

function CustomerReturn({ receiptLanguage }: { receiptLanguage: "fr" | "en" }) {
  const t = useTranslations("returns");
  const { money, locale } = useFormat();
  const [code, setCode] = useState("");
  const [sale, setSale] = useState<SaleToReturn | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [quarantine, setQuarantine] = useState<Record<string, boolean>>({});
  const [mode, setMode] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ReceiptData | null>(null);

  const find = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const found = await rpc<SaleToReturn>("returns.find_sale", { code: code.trim() });
      setSale(found);
      setQty({});
      setQuarantine({});
      setMode(found.payments[0] ?? "Espèces");
    } catch {
      toast.error(t("notFound"));
    } finally {
      setBusy(false);
      setCode("");
    }
  };

  const refund = fromCents(
    (sale?.lines ?? []).reduce((s, l) => s + toCents(l.rate) * (qty[l.row] ?? 0), 0),
  );
  const needsPin = !!sale && sale.needs_pin_role && refund > sale.pin_threshold;

  const submit = async (withPin?: string) => {
    if (!sale) return;
    setBusy(true);
    try {
      const receipt = await rpc<ReceiptData>(
        "returns.submit_return",
        {
          invoice: sale.name,
          refund_mode: mode,
          pin: withPin,
          lines: sale.lines.map((l) => ({ row: l.row, qty: qty[l.row] ?? 0, to_quarantine: quarantine[l.row] ? 1 : 0 })),
        },
        true,
      );
      toast.success(t("done"));
      setPinOpen(false);
      setPin("");
      setSale(null);
      setDone(receipt);
    } catch (e) {
      toast.error((e as Error).message);
      if (e instanceof ApiError && e.status === 403) setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <InputGroup className="h-12">
        <InputGroupAddon>{busy && !sale ? <Loader2 className="animate-spin" /> : <ScanBarcode />}</InputGroupAddon>
        <InputGroupInput
          autoFocus
          placeholder={t("scan")}
          aria-label={t("scan")}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void find();
            }
          }}
        />
      </InputGroup>

      {sale && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("sale", { name: sale.name, date: new Date(sale.posting_date).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB") })}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <ul className="divide-y rounded-lg border">
              {sale.lines.map((l) => {
                const n = qty[l.row] ?? 0;
                return (
                  <li key={l.row} className="grid gap-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="grid">
                        <span className="font-medium">{l.item_name}</span>
                        <span className="text-muted-foreground num text-xs">
                          {money(l.rate)} · {t("returnable", { qty: l.returnable })}
                        </span>
                      </span>
                      <span className="num font-semibold">{n ? money(n * l.rate) : ""}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" size="icon" className="size-11" aria-label="−" disabled={n <= 0} onClick={() => setQty((q) => ({ ...q, [l.row]: n - 1 }))}>
                        <Minus />
                      </Button>
                      <span className="num w-8 text-center text-lg font-semibold" data-testid={`return-qty-${l.item_code}`}>
                        {n}
                      </span>
                      <Button variant="outline" size="icon" className="size-11" aria-label="+" disabled={n >= l.returnable} onClick={() => setQty((q) => ({ ...q, [l.row]: n + 1 }))}>
                        <Plus />
                      </Button>
                      {n > 0 && (
                        <label className="ms-auto flex min-h-11 items-center gap-2 text-sm">
                          <Checkbox checked={!!quarantine[l.row]} onCheckedChange={(v) => setQuarantine((q) => ({ ...q, [l.row]: v === true }))} />
                          {t("toQuarantine")}
                        </label>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <Field>
              <FieldLabel>{t("refund")}</FieldLabel>
              <ToggleGroup type="single" variant="outline" value={mode} onValueChange={(v) => v && setMode(v)} className="w-full">
                {["Espèces", "Carte bancaire"].map((m) => (
                  <ToggleGroupItem key={m} value={m} className="h-11 flex-1">
                    {m}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
            <div className="bg-muted flex items-baseline justify-between rounded-lg p-3">
              <span className="font-medium">{t("refundTotal")}</span>
              <span className="num text-2xl font-bold" data-testid="refund-total">{money(refund)}</span>
            </div>
            <Button size="lg" className="h-12" disabled={busy || refund <= 0 || !mode} onClick={() => (needsPin ? setPinOpen(true) : void submit())}>
              {busy && <Loader2 className="animate-spin" />}
              {t("submit")}
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("pinTitle")}</DialogTitle>
            <DialogDescription>{t("pinHint", { amount: money(sale?.pin_threshold ?? 0) })}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(pin);
            }}
          >
            <InputOTP maxLength={6} value={pin} onChange={setPin} autoFocus inputMode="numeric" containerClassName="justify-center" pattern="^[0-9]*$" aria-label={t("pinTitle")}>
              <InputOTPGroup>
                {Array.from({ length: 6 }, (_, i) => (
                  <InputOTPSlot key={i} index={i} className="size-11 text-lg" />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <Button type="submit" size="lg" disabled={busy || pin.length < 4}>
              {busy && <Loader2 className="animate-spin" />}
              {t("pinConfirm")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!done} onOpenChange={(o) => !o && setDone(null)}>
        <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("done")}</DialogTitle>
          </DialogHeader>
          {done && (
            <>
              <div className="print-area print-receipt overflow-hidden rounded-lg border">
                <Receipt receipt={done} language={receiptLanguage} />
              </div>
              <Button variant="outline" size="lg" onClick={printReceipt}>
                <Printer />
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SupplierReturns() {
  const t = useTranslations("returns.supplier");
  const tr = useTranslations("returns");
  const queryClient = useQueryClient();
  const { money, locale } = useFormat();
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ["returns", "supplier"], queryFn: () => rpc<SupplierReturnRow[]>("returns.list_supplier_returns") });
  const drafts = list.data?.filter((r) => r.docstatus === 0) ?? [];
  const sent = list.data?.filter((r) => r.docstatus === 1) ?? [];

  const send = async (name: string) => {
    setBusy(name);
    try {
      await rpc("returns.submit_supplier_return", { name }, true);
      toast.success(t("sentToast"));
      await queryClient.invalidateQueries({ queryKey: ["returns"] });
      await queryClient.invalidateQueries({ queryKey: ["stock"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const row = (r: SupplierReturnRow, action?: React.ReactNode) => (
    <li key={r.name} className="bg-card grid gap-2 rounded-xl border p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="grid">
          <span className="font-medium">{r.supplier_name}</span>
          <span className="text-muted-foreground num text-xs">
            {t("from", { name: r.return_against })} · {new Date(r.posting_date).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB")}
          </span>
        </span>
        {r.grand_total !== undefined && <span className="num text-sm">{money(Math.abs(r.grand_total))}</span>}
      </div>
      <ul className="text-muted-foreground text-sm">
        {r.lines.map((l, i) => (
          <li key={i}>
            {Math.abs(l.qty) || Math.abs(l.rejected_qty)} × {l.item_name}
          </li>
        ))}
      </ul>
      {action}
    </li>
  );

  if (list.isPending) return <Skeleton className="h-32" />;
  return (
    <div className="grid gap-4">
      <Button variant="outline" size="lg" className="sm:justify-self-end" onClick={() => setCreating(true)}>
        <Truck /> {tr("newReturn")}
      </Button>
      {!list.data?.length && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{t("none")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {drafts.length > 0 && (
        <section className="grid gap-2">
          <h3 className="text-sm font-medium">{t("drafts")}</h3>
          <ul className="grid gap-2">
            {drafts.map((r) =>
              row(
                r,
                <Button className="justify-self-end" disabled={busy === r.name} onClick={() => void send(r.name)}>
                  {busy === r.name && <Loader2 className="animate-spin" />}
                  {t("send")}
                </Button>,
              ),
            )}
          </ul>
        </section>
      )}
      {sent.length > 0 && (
        <section className="grid gap-2">
          <h3 className="text-muted-foreground text-sm font-medium">{t("sent")}</h3>
          <ul className="grid gap-2">{sent.map((r) => row(r, <Badge variant="secondary" className="justify-self-end">{r.status}</Badge>))}</ul>
        </section>
      )}
      <NewSupplierReturn open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function NewSupplierReturn({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("returns.supplier");
  const queryClient = useQueryClient();
  const [receipt, setReceipt] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const receipts = useQuery({ queryKey: ["purchasing", "receipts"], queryFn: () => rpc<ReceiptRow[]>("purchasing.list_receipts"), enabled: open });
  const lines = useQuery({
    queryKey: ["returns", "receipt-lines", receipt],
    queryFn: () => rpc<{ row: string; item_name: string; returnable: number }[]>("returns.receipt_lines", { receipt }),
    enabled: !!receipt,
  });

  const create = async () => {
    setBusy(true);
    try {
      await rpc("returns.create_supplier_return", { receipt, lines: Object.entries(qty).map(([row, q]) => ({ row, qty: Number(q) || 0 })) }, true);
      toast.success(t("sentToast"));
      await queryClient.invalidateQueries({ queryKey: ["returns"] });
      await queryClient.invalidateQueries({ queryKey: ["stock"] });
      setReceipt("");
      setQty({});
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("create")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Field>
            <FieldLabel>{t("chooseReceipt")}</FieldLabel>
            <Select value={receipt} onValueChange={(v) => { setReceipt(v); setQty({}); }}>
              <SelectTrigger className="h-11 w-full" aria-label={t("chooseReceipt")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {receipts.data?.map((r) => (
                  <SelectItem key={r.name} value={r.name}>
                    {r.supplier_name} · {r.supplier_delivery_note || r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {lines.data?.map((l) => (
            <label key={l.row} className="flex items-center justify-between gap-3">
              <span className="text-sm">{l.item_name}</span>
              <Input
                inputMode="numeric"
                className="num h-11 w-20"
                aria-label={l.item_name}
                placeholder={`≤ ${l.returnable}`}
                value={qty[l.row] ?? ""}
                onChange={(e) => setQty((q) => ({ ...q, [l.row]: e.target.value.replace(/\D/g, "") }))}
              />
            </label>
          ))}
          <Button size="lg" disabled={busy || !Object.values(qty).some((q) => Number(q) > 0)} onClick={() => void create()}>
            {busy && <Loader2 className="animate-spin" />}
            {t("create")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
