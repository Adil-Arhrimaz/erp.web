"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Banknote, Loader2, Plus, ReceiptText, ShieldAlert, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFormat } from "@/hooks/use-format";
import { rpc } from "@/lib/api-client";
import { documentTotals, fromCents, toCents } from "@/lib/money";
import {
  type CashLimitCheck,
  type Invoice,
  type InvoiceLine,
  type InvoiceRow,
  type SupplierPaymentMode,
  priceDiffers,
} from "@/lib/purchasing/types";
import { cn } from "@/lib/utils";

import { PageToolbar } from "./page-toolbar";
import { SupplierSelect } from "./supplier-select";
import { TotalsBox } from "./totals-box";

type Tab = "all" | "draft" | "unpaid" | "paid";
const num = (v: string) => Number(v.replace(",", ".").replace(/\s/g, "")) || 0;

export function InvoiceStatus({ invoice }: { invoice: Pick<InvoiceRow, "docstatus" | "outstanding_amount" | "grand_total" | "due_date"> }) {
  const t = useTranslations("purchasing.invoices.status");
  if (invoice.docstatus === 0) return <Badge variant="outline">{t("draft")}</Badge>;
  if (invoice.outstanding_amount <= 0) return <Badge className="bg-success/15 text-success">{t("paid")}</Badge>;
  if (invoice.due_date && invoice.due_date < new Date().toISOString().slice(0, 10)) return <Badge variant="destructive">{t("overdue")}</Badge>;
  if (invoice.outstanding_amount < invoice.grand_total) return <Badge className="bg-warning text-warning-foreground">{t("partly")}</Badge>;
  return <Badge variant="secondary">{t("unpaid")}</Badge>;
}

export function InvoicesView({ canCreate }: { canCreate: boolean }) {
  const t = useTranslations("purchasing.invoices");
  const tc = useTranslations("purchasing.common");
  const { money, locale } = useFormat();
  const [tab, setTab] = useState<Tab>("unpaid");
  const invoices = useQuery({
    queryKey: ["purchasing", "invoices", tab],
    queryFn: () => rpc<InvoiceRow[]>("purchasing.list_invoices", { status: tab === "all" ? undefined : tab }),
  });
  const date = (d: string | null) => (d ? new Date(d).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB") : "");

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <PageToolbar
        tabs={(["unpaid", "draft", "paid", "all"] as const).map((v) => ({ value: v, label: t(`tabs.${v}`) }))}
        value={tab}
        onChange={setTab}
        newHref={canCreate ? "/supplier-invoices/new" : undefined}
        newLabel={t("new")}
      />
      {invoices.isPending ? (
        <Skeleton className="h-40" />
      ) : !invoices.data?.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{tc("empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-2">
          {invoices.data.map((i) => (
            <li key={i.name}>
              <Link
                href={`/supplier-invoices/${encodeURIComponent(i.name)}`}
                className="bg-card hover:bg-accent grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-xl border p-3"
              >
                <span className="grid min-w-0">
                  <span className="flex items-center gap-2 truncate font-medium">
                    {i.supplier_name}
                    {!i.pp_company_ice_on_invoice && <ShieldAlert className="text-warning-foreground size-4" aria-label={t("iceWarning")} />}
                  </span>
                  <span className="text-muted-foreground num text-xs">
                    {[i.bill_no, date(i.bill_date), i.due_date && `${t("due")} ${date(i.due_date)}`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <InvoiceStatus invoice={i} />
                  <span className="num text-sm font-semibold">
                    {i.docstatus === 1 && i.outstanding_amount > 0 && i.outstanding_amount < i.grand_total
                      ? `${money(i.outstanding_amount)} / ${money(i.grand_total)}`
                      : money(i.grand_total)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface EditLine extends Omit<InvoiceLine, "qty" | "rate"> {
  key: string;
  qty: string;
  rate: string;
}

export function InvoiceEditor() {
  const t = useTranslations("purchasing.invoices");
  const tc = useTranslations("purchasing.common");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { money, locale } = useFormat();
  const decimal = (n: number) => (locale === "fr" ? n.toFixed(2).replace(".", ",") : n.toFixed(2));

  const [supplier, setSupplier] = useState<string | null>(null);
  const [kind, setKind] = useState<"goods" | "overheads">("goods");
  const [selected, setSelected] = useState<string[]>([]);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [ice, setIce] = useState(false);
  const [busy, setBusy] = useState(false);

  const receipts = useQuery({
    queryKey: ["purchasing", "open-receipts", supplier],
    queryFn: () =>
      rpc<{ name: string; supplier_delivery_note: string | null; posting_date: string; grand_total: number }[]>(
        "purchasing.open_receipts",
        { supplier },
      ),
    enabled: !!supplier && kind === "goods",
  });
  const overheads = useQuery({
    queryKey: ["purchasing", "overhead-items"],
    queryFn: () => rpc<{ item_code: string; item_name: string; vat_rate: number | null }[]>("purchasing.overhead_items"),
    enabled: kind === "overheads",
  });

  const loadLines = async () => {
    if (!supplier || !selected.length) return;
    setBusy(true);
    try {
      const preview = await rpc<{ lines: InvoiceLine[] }>("purchasing.preview_invoice", { supplier, receipts: selected });
      setLines(preview.lines.map((l, i) => ({ ...l, key: `${l.pr_detail ?? i}`, qty: String(l.qty), rate: decimal(l.rate) })));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const preview = documentTotals(lines.map((l) => ({ unitTtc: toCents(num(l.rate)), qty: num(l.qty), vatRate: l.vat_rate ?? 0 })));

  const save = async () => {
    setBusy(true);
    try {
      const result = await rpc<Invoice>(
        "purchasing.save_invoice",
        {
          invoice: {
            supplier,
            bill_no: billNo,
            bill_date: billDate,
            pp_company_ice_on_invoice: ice ? 1 : 0,
            receipts: kind === "goods" ? selected : [],
            lines: lines.map((l) => ({ item_code: l.item_code, qty: num(l.qty), rate: num(l.rate), pr_detail: l.pr_detail })),
          },
        },
        true,
      );
      toast.success(t("draftSaved"));
      await queryClient.invalidateQueries({ queryKey: ["purchasing"] });
      router.replace(`/supplier-invoices/${encodeURIComponent(result.name)}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label={tc("back")}>
          <Link href="/supplier-invoices">
            <ArrowLeft className="rtl:rotate-180" />
          </Link>
        </Button>
        <h2 className="text-xl font-semibold">{t("new")}</h2>
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="supplier">{tc("supplier")}</FieldLabel>
            <SupplierSelect
              id="supplier"
              value={supplier}
              onChange={(s) => {
                setSupplier(s?.name ?? null);
                setSelected([]);
                setLines([]);
              }}
            />
          </Field>
          <Field>
            <FieldLabel>{t("kind")}</FieldLabel>
            <ToggleGroup
              type="single"
              variant="outline"
              value={kind}
              onValueChange={(v) => {
                if (!v) return;
                setKind(v as "goods" | "overheads");
                setLines([]);
              }}
              className="w-full"
            >
              <ToggleGroupItem value="goods" className="h-10 flex-1">
                {t("goods")}
              </ToggleGroupItem>
              <ToggleGroupItem value="overheads" className="h-10 flex-1">
                {t("overheads")}
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="bill-no">{t("billNo")}</FieldLabel>
            <Input id="bill-no" className="h-10" value={billNo} onChange={(e) => setBillNo(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="bill-date">{t("billDate")}</FieldLabel>
            <Input id="bill-date" type="date" className="h-10" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </Field>
          <label className="flex min-h-11 items-center gap-3 sm:col-span-2">
            <Checkbox checked={ice} onCheckedChange={(v) => setIce(v === true)} />
            <span className="text-sm font-medium">{t("ice")}</span>
          </label>
          {!ice && (
            <Alert className="border-warning bg-warning/10 sm:col-span-2">
              <ShieldAlert />
              <AlertDescription className="text-foreground">{t("iceWarning")}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {supplier && kind === "goods" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("receipts")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {receipts.isPending ? (
              <Skeleton className="h-12" />
            ) : !receipts.data?.length ? (
              <p className="text-muted-foreground text-sm">{t("noReceipts")}</p>
            ) : (
              <>
                {receipts.data.map((r) => (
                  <label key={r.name} className="hover:bg-accent flex min-h-12 items-center gap-3 rounded-lg border px-3">
                    <Checkbox
                      checked={selected.includes(r.name)}
                      onCheckedChange={(v) => setSelected((s) => (v === true ? [...s, r.name] : s.filter((x) => x !== r.name)))}
                    />
                    <span className="grid flex-1 text-sm">
                      <span className="font-medium">{r.supplier_delivery_note || r.name}</span>
                      <span className="text-muted-foreground num text-xs">
                        {r.name} · {new Date(r.posting_date).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB")}
                      </span>
                    </span>
                    <span className="num text-sm">{money(r.grand_total)}</span>
                  </label>
                ))}
                <Button variant="secondary" className="justify-self-start" disabled={!selected.length || busy} onClick={() => void loadLines()}>
                  {busy && <Loader2 className="animate-spin" />}
                  {t("loadLines")}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {(lines.length > 0 || (supplier && kind === "overheads")) && (
        <Card>
          <CardContent className="grid gap-3 pt-6">
            <ul className="divide-y rounded-lg border">
              {lines.map((l, i) => {
                const differs = !!l.receipt_rate && priceDiffers(num(l.rate), l.receipt_rate);
                return (
                  <li key={l.key} className={cn("grid grid-cols-[1fr_5rem_7rem_auto] items-center gap-2 p-3", differs && "bg-destructive/5")}>
                    <span className="grid min-w-0">
                      <span className="truncate text-sm font-medium">
                        {l.item_name} {l.is_free_item ? <Badge variant="secondary">{t("freeItem")}</Badge> : null}
                      </span>
                      {l.receipt_rate != null && (
                        <span className={cn("num text-xs", differs ? "text-destructive font-medium" : "text-muted-foreground")}>
                          {differs ? t("priceDiffers", { rate: money(l.receipt_rate) }) : `${t("receiptRate")} ${money(l.receipt_rate)}`}
                        </span>
                      )}
                    </span>
                    <Input
                      aria-label={tc("qty")}
                      inputMode="numeric"
                      className="num h-11"
                      value={l.qty}
                      onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                    />
                    <Input
                      aria-label={tc("priceTtc")}
                      inputMode="decimal"
                      className={cn("num h-11", differs && "border-destructive")}
                      value={l.rate}
                      onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))}
                    />
                    {kind === "overheads" ? (
                      <Button variant="ghost" size="icon" className="size-11" aria-label={tc("remove")} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                        <Trash2 />
                      </Button>
                    ) : (
                      <span className="num w-20 text-end text-sm">{money(num(l.qty) * num(l.rate))}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {kind === "overheads" && (
              <Select
                value=""
                onValueChange={(code) => {
                  const item = overheads.data?.find((o) => o.item_code === code);
                  if (item) setLines((ls) => [...ls, { ...item, key: `${code}-${Date.now()}`, qty: "1", rate: "" }]);
                }}
              >
                <SelectTrigger className="h-11 w-full sm:w-72" aria-label={t("addLine")}>
                  <SelectValue placeholder={<span className="flex items-center gap-2"><Plus className="size-4" /> {t("addLine")}</span>} />
                </SelectTrigger>
                <SelectContent>
                  {overheads.data?.map((o) => (
                    <SelectItem key={o.item_code} value={o.item_code}>
                      {o.item_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {lines.length > 0 && (
              <div className="sm:ms-auto sm:w-80">
                <TotalsBox
                  totals={{
                    ht: fromCents(preview.ht),
                    vat: fromCents(preview.vat),
                    ttc: fromCents(preview.ttc),
                    vat_by_rate: preview.byRate.map((r) => ({ rate: r.vatRate, ht: fromCents(r.ht), vat: fromCents(r.vat) })),
                  }}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button size="lg" disabled={busy || !supplier || !billNo.trim() || !lines.length} onClick={() => void save()}>
          {busy && <Loader2 className="animate-spin" />}
          {t("saveDraft")}
        </Button>
      </div>
    </div>
  );
}

export function InvoiceDetail({ initial }: { initial: Invoice }) {
  const t = useTranslations("purchasing.invoices");
  const tc = useTranslations("purchasing.common");
  const queryClient = useQueryClient();
  const { money, locale } = useFormat();
  const [invoice, setInvoice] = useState(initial);
  const [payOpen, setPayOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const tr = useTranslations("returns.debitNote");
  const date = (d: string | null) => (d ? new Date(d).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB") : "");

  const submit = async () => {
    setBusy(true);
    try {
      setInvoice(await rpc<Invoice>("purchasing.submit_invoice", { name: invoice.name }, true));
      toast.success(t("submitted"));
      await queryClient.invalidateQueries({ queryKey: ["purchasing"] });
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
          <Link href="/supplier-invoices">
            <ArrowLeft className="rtl:rotate-180" />
          </Link>
        </Button>
        <div className="grid">
          <h2 className="text-xl font-semibold">{invoice.supplier_name}</h2>
          <span className="text-muted-foreground num text-xs">
            {[invoice.bill_no, date(invoice.bill_date), invoice.name].filter(Boolean).join(" · ")}
          </span>
        </div>
        <InvoiceStatus invoice={{ ...invoice, outstanding_amount: invoice.outstanding, grand_total: invoice.totals.ttc }} />
        <div className="ms-auto flex gap-2">
          {invoice.can_submit && (
            <Button size="lg" disabled={busy} onClick={() => void submit()}>
              {busy && <Loader2 className="animate-spin" />}
              {t("submit")}
            </Button>
          )}
          {invoice.docstatus === 1 && (
            <Button size="lg" variant="outline" onClick={() => setCreditOpen(true)}>
              <ReceiptText /> {tr("button")}
            </Button>
          )}
          {invoice.can_pay && (
            <Button size="lg" onClick={() => setPayOpen(true)}>
              <Banknote /> {t("pay")}
            </Button>
          )}
        </div>
      </div>

      {!invoice.pp_company_ice_on_invoice && (
        <Alert className="border-warning bg-warning/10">
          <ShieldAlert />
          <AlertDescription className="text-foreground">{t("iceWarning")}</AlertDescription>
        </Alert>
      )}
      {invoice.warnings.map((w) => (
        <Alert key={w.row} variant="destructive">
          <TriangleAlert />
          <AlertDescription>
            {w.item_name} : {money(w.invoice_rate)} — {t("priceDiffers", { rate: money(w.receipt_rate) })}
          </AlertDescription>
        </Alert>
      ))}

      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tc("product")}</TableHead>
                  <TableHead className="text-end">{tc("qty")}</TableHead>
                  <TableHead className="text-end">{tc("priceTtc")}</TableHead>
                  <TableHead className="text-end">{tc("amount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.lines.map((l, i) => (
                  <TableRow key={`${l.item_code}-${i}`} className={cn(priceDiffers(l.rate, l.receipt_rate) && "bg-destructive/5")}>
                    <TableCell>
                      {l.item_name} {l.is_free_item ? <Badge variant="secondary">{t("freeItem")}</Badge> : null}
                    </TableCell>
                    <TableCell className="num text-end">{l.qty}</TableCell>
                    <TableCell className="num text-end">{money(l.rate)}</TableCell>
                    <TableCell className="num text-end">{money(l.amount ?? l.qty * l.rate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="sm:ms-auto sm:w-80">
            <TotalsBox totals={invoice.totals} />
            {invoice.docstatus === 1 && (
              <p className="num mt-2 flex justify-between text-sm font-semibold">
                <span>{t("outstanding")}</span>
                <span data-testid="outstanding">{money(invoice.outstanding)}</span>
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {invoice.docstatus === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("payments")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {invoice.payments.length === 0 ? (
              <p className="text-muted-foreground">{t("noPayments")}</p>
            ) : (
              invoice.payments.map((p) => (
                <p key={p.name} className="flex justify-between gap-3">
                  <span>
                    {date(p.posting_date)} · {p.mode_of_payment}
                    {p.reference_no && ` · ${p.reference_no}`}
                  </span>
                  <span className="num">{money(p.amount)}</span>
                </p>
              ))
            )}
            {invoice.outstanding > 0 && <p className="text-muted-foreground text-xs">{t("vatDeductibleNote")}</p>}
          </CardContent>
        </Card>
      )}

      <DebitNoteDialog
        open={creditOpen}
        onOpenChange={setCreditOpen}
        invoice={invoice}
        onDone={(next) => {
          setInvoice(next);
          setCreditOpen(false);
          void queryClient.invalidateQueries({ queryKey: ["purchasing"] });
        }}
      />

      <PayDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        invoice={invoice}
        onPaid={(next) => {
          setInvoice(next);
          setPayOpen(false);
          void queryClient.invalidateQueries({ queryKey: ["purchasing"] });
        }}
      />
    </div>
  );
}

function PayDialog({
  open,
  onOpenChange,
  invoice,
  onPaid,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice;
  onPaid: (invoice: Invoice) => void;
}) {
  const t = useTranslations("purchasing.invoices");
  const { money, locale } = useFormat();
  const decimal = (n: number) => (locale === "fr" ? n.toFixed(2).replace(".", ",") : n.toFixed(2));
  const [mode, setMode] = useState("");
  const [amount, setAmount] = useState(decimal(invoice.outstanding));
  const [reference, setReference] = useState("");
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const modes = useQuery({
    queryKey: ["purchasing", "payment-modes"],
    queryFn: () => rpc<SupplierPaymentMode[]>("purchasing.payment_modes"),
    enabled: open,
  });
  const modeType = modes.data?.find((m) => m.mode_of_payment === mode)?.type;
  const value = num(amount);
  const deferredValue = useDeferredValue(value);
  const cash = useQuery({
    queryKey: ["purchasing", "cash-limit", invoice.name, deferredValue, day],
    queryFn: () => rpc<CashLimitCheck>("purchasing.check_cash_limit", { invoice: invoice.name, amount: deferredValue, posting_date: day }),
    enabled: open && modeType === "Cash" && deferredValue > 0,
  });

  const pay = async () => {
    setBusy(true);
    try {
      const next = await rpc<Invoice>(
        "purchasing.pay_invoice",
        { invoice: invoice.name, amount: value, mode_of_payment: mode, posting_date: day, reference_no: reference },
        true,
      );
      toast.success(t("paid"));
      onPaid(next);
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
          <DialogTitle>{t("payTitle", { name: invoice.bill_no ?? invoice.name })}</DialogTitle>
          <DialogDescription>
            {t("outstanding")} : <span className="num font-semibold">{money(invoice.outstanding)}</span>
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void pay();
          }}
        >
          <Field>
            <FieldLabel>{t("mode")}</FieldLabel>
            <ToggleGroup type="single" variant="outline" value={mode} onValueChange={(v) => v && setMode(v)} className="w-full flex-wrap">
              {modes.data?.map((m) => (
                <ToggleGroupItem key={m.mode_of_payment} value={m.mode_of_payment} className="h-11 flex-1">
                  {m.mode_of_payment}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="pay-amount">{t("outstanding")}</FieldLabel>
              <InputGroup className="h-11">
                <InputGroupInput id="pay-amount" inputMode="decimal" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <InputGroupAddon align="inline-end">DH</InputGroupAddon>
              </InputGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="pay-date">{t("billDate")}</FieldLabel>
              <Input id="pay-date" type="date" className="h-11" value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
          </div>
          {modeType === "Bank" && (
            <Field>
              <FieldLabel htmlFor="pay-ref">{t("reference")}</FieldLabel>
              <Input id="pay-ref" className="h-11" value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
          )}
          {modeType === "Cash" && cash.data && (
            cash.data.over_amount > 0 ? (
              <Alert variant="destructive" data-testid="cash-limit">
                <TriangleAlert />
                <AlertDescription>
                  {t("cashLimit", {
                    daily: money(cash.data.daily_limit),
                    monthly: money(cash.data.monthly_limit),
                    over: money(cash.data.over_amount),
                    vat: money(cash.data.vat_at_risk),
                  })}
                </AlertDescription>
              </Alert>
            ) : (
              <p className="text-muted-foreground text-xs">
                {t("cashTotals", { day: money(cash.data.daily_total), month: money(cash.data.monthly_total) })}
              </p>
            )
          )}
          <Button
            type="submit"
            size="lg"
            disabled={busy || !mode || value <= 0 || value > invoice.outstanding + 0.001 || (modeType === "Bank" && !reference.trim())}
          >
            {busy && <Loader2 className="animate-spin" />}
            {t("pay")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DebitNoteDialog({
  open,
  onOpenChange,
  invoice,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice;
  onDone: (invoice: Invoice) => void;
}) {
  const t = useTranslations("returns.debitNote");
  const { money } = useFormat();
  const [number, setNumber] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const lines = invoice.lines.filter((l) => l.row && !l.is_free_item);

  const save = async () => {
    setBusy(true);
    try {
      const next = await rpc<Invoice>(
        "returns.create_debit_note",
        { invoice: invoice.name, bill_no: number, lines: Object.entries(qty).map(([row, q]) => ({ row, qty: Number(q) || 0 })) },
        true,
      );
      toast.success(t("done"));
      setNumber("");
      setQty({});
      onDone(next);
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
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field>
            <FieldLabel htmlFor="dn-number">{t("number")}</FieldLabel>
            <Input id="dn-number" className="h-11" value={number} onChange={(e) => setNumber(e.target.value)} />
          </Field>
          {lines.map((l) => (
            <label key={l.row} className="flex items-center justify-between gap-3">
              <span className="text-sm">
                {l.item_name} <span className="text-muted-foreground num">· {l.qty} × {money(l.rate)}</span>
              </span>
              <Input
                inputMode="numeric"
                aria-label={`${t("qty")} ${l.item_name}`}
                className="num h-11 w-20"
                value={qty[l.row!] ?? ""}
                onChange={(e) => setQty((q) => ({ ...q, [l.row!]: e.target.value.replace(/\D/g, "") }))}
              />
            </label>
          ))}
          <Button size="lg" disabled={busy || !number.trim() || !Object.values(qty).some((q) => Number(q) > 0)} onClick={() => void save()}>
            {busy && <Loader2 className="animate-spin" />}
            {t("submit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
