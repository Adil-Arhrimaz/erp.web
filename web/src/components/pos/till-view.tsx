"use client";

import { ArrowRight, HandCoins, Loader2, Lock, Printer, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useSession } from "@/components/session-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFormat } from "@/hooks/use-format";
import { api, rpc } from "@/lib/api-client";
import { fromCents, toCents } from "@/lib/money";
import type { CashOut, ClosingPreview, TillStatus, ZReport } from "@/lib/pos/types";
import { cn } from "@/lib/utils";

import { printReceipt } from "./receipt";
import { useOutbox } from "./use-pos-data";
import { ZReportView } from "./z-report";

const NOTES = [200, 100, 50, 20];
const COINS = [10, 5, 2, 1, 0.5, 0.2, 0.1];

const parseAmount = (v: string) => {
  const n = Number(v.replace(",", ".").replace(/\s/g, ""));
  return v.trim() === "" || !Number.isFinite(n) || n < 0 ? null : n;
};

export function TillView({ initialStatus }: { initialStatus: TillStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [z, setZ] = useState<ZReport | null>(null);

  if (z) return <ZDone report={z} onNewDay={() => setZ(null)} />;
  if (!status.opening) return <OpenTill status={status} onOpened={setStatus} />;
  return (
    <CloseTill
      status={status}
      onClosed={(report) => {
        setZ(report);
        setStatus({ ...status, opening: null });
      }}
    />
  );
}

function OpenTill({ status, onOpened }: { status: TillStatus; onOpened: (s: TillStatus) => void }) {
  const t = useTranslations("till");
  const router = useRouter();
  const free = status.tills.filter((x) => !x.open_by);
  const [till, setTill] = useState(free[0]?.name ?? "");
  const [cash, setCash] = useState("");
  const [busy, setBusy] = useState(false);
  const amount = parseAmount(cash);

  const open = async () => {
    if (!till || amount === null) return;
    setBusy(true);
    try {
      const next = await api<TillStatus>("/api/pos/open", { method: "POST", json: { pos_profile: till, cash_float: amount } });
      onOpened(next);
      toast.success(t("opened"));
      router.push("/pos");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>{t("open")}</CardTitle>
        <CardDescription>{t("floatHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void open();
          }}
        >
          <Field>
            <FieldLabel>{t("chooseTill")}</FieldLabel>
            <ToggleGroup type="single" variant="outline" value={till} onValueChange={(v) => v && setTill(v)} className="w-full flex-wrap">
              {status.tills.map((x) => (
                <ToggleGroupItem key={x.name} value={x.name} disabled={!!x.open_by} className="h-auto min-h-12 flex-1 flex-col py-2">
                  <span className="font-medium">{x.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {x.open_by ? t("openBy", { user: x.open_by }) : t("available")}
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="float">{t("float")}</FieldLabel>
            <InputGroup className="h-12">
              <InputGroupInput
                id="float"
                autoFocus
                inputMode="decimal"
                className="num text-xl"
                value={cash}
                onChange={(e) => setCash(e.target.value)}
              />
              <InputGroupAddon align="inline-end">DH</InputGroupAddon>
            </InputGroup>
          </Field>
          <Button type="submit" size="lg" className="h-12" disabled={!till || amount === null || busy}>
            {busy && <Loader2 className="animate-spin" />}
            {t("open")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function CloseTill({ status, onClosed }: { status: TillStatus; onClosed: (z: ZReport) => void }) {
  const t = useTranslations("till");
  const tp = useTranslations("pos");
  const session = useSession();
  const { money, locale } = useFormat();
  const outbox = useOutbox(session.user);
  const opening = status.opening!;
  const [step, setStep] = useState<"idle" | "count" | "review">("idle");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [card, setCard] = useState("");
  const [preview, setPreview] = useState<ClosingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [cashOutOpen, setCashOutOpen] = useState(false);
  const [cashOuts, setCashOuts] = useState<CashOut[]>([]);

  const cashMode = opening.payment_modes.find((m) => m.type === "Cash")?.mode_of_payment;
  const cardMode = opening.payment_modes.find((m) => m.type === "Bank")?.mode_of_payment;
  const countedCash = fromCents(
    [...NOTES, ...COINS].reduce((s, d) => s + toCents(d) * (Number.parseInt(counts[d] ?? "", 10) || 0), 0),
  );
  const counted: Record<string, number> = {
    ...(cashMode && { [cashMode]: countedCash }),
    ...(cardMode && { [cardMode]: parseAmount(card) ?? 0 }),
  };
  const since = new Date(opening.period_start_date.replace(" ", "T")).toLocaleString(
    locale === "fr" ? "fr-FR" : "en-GB",
    { dateStyle: "short", timeStyle: "short" },
  );

  const review = async () => {
    setBusy(true);
    try {
      setPreview(await api<ClosingPreview>("/api/pos/closing"));
      setStep("review");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    setBusy(true);
    try {
      const z = await api<ZReport>("/api/pos/close", { method: "POST", json: { counted } });
      toast.success(t("closed"));
      onClosed(z);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("openSince", { till: opening.pos_profile, time: since })}</CardTitle>
          <CardDescription>
            {t("openingFloat", { amount: money(cashMode ? opening.opening_amounts[cashMode] ?? 0 : 0) })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {!opening.outdated && (
            <Button asChild size="lg">
              <Link href="/pos">
                {t("goToPos")} <ArrowRight className="rtl:rotate-180" />
              </Link>
            </Button>
          )}
          {!opening.outdated && (
            <Button size="lg" variant="outline" onClick={() => setCashOutOpen(true)}>
              <HandCoins /> {t("cashOut.button")}
            </Button>
          )}
          {step === "idle" && (
            <Button size="lg" variant="outline" onClick={() => setStep("count")}>
              <Lock /> {t("close")}
            </Button>
          )}
        </CardContent>
        {cashOuts.length > 0 && (
          <CardContent>
            <CashOutList items={cashOuts} />
          </CardContent>
        )}
      </Card>

      <CashOutDialog
        open={cashOutOpen}
        onOpenChange={setCashOutOpen}
        onSaved={(list) => {
          setCashOuts(list);
          setCashOutOpen(false);
        }}
      />

      {opening.outdated && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{tp("till.outdatedBody")}</AlertDescription>
        </Alert>
      )}

      {step !== "idle" && outbox.pending > 0 && (
        <Alert className="border-warning bg-warning/10">
          <TriangleAlert />
          <AlertDescription className="text-foreground flex flex-wrap items-center gap-3">
            {t("pendingBlock", { count: outbox.pending })}
            <Button size="sm" variant="outline" onClick={() => void outbox.sync()}>
              {t("sendNow")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {step === "count" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("countTitle")}</CardTitle>
            <CardDescription>{t("countHint")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {[
              { label: t("notes"), values: NOTES },
              { label: t("coins"), values: COINS },
            ].map((group) => (
              <fieldset key={group.label} className="grid gap-2">
                <legend className="text-muted-foreground mb-1 text-sm font-medium">{group.label}</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {group.values.map((d) => (
                    <label key={d} className="flex items-center gap-2 rounded-lg border p-2">
                      <span className="num w-14 shrink-0 text-end text-sm font-semibold">{money(d).replace(/\s?DH$/, "")}</span>
                      <span className="text-muted-foreground">×</span>
                      <Input
                        inputMode="numeric"
                        aria-label={money(d)}
                        className="num h-11"
                        value={counts[d] ?? ""}
                        onChange={(e) => setCounts((c) => ({ ...c, [d]: e.target.value.replace(/\D/g, "") }))}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <div className="bg-muted flex items-baseline justify-between rounded-lg p-3">
              <span className="font-medium">{t("countedCash")}</span>
              <span className="num text-2xl font-bold" data-testid="counted-cash">{money(countedCash)}</span>
            </div>
            {cardMode && (
              <Field>
                <FieldLabel htmlFor="card-total">{t("cardTotal")}</FieldLabel>
                <InputGroup className="h-12 sm:max-w-64">
                  <InputGroupInput id="card-total" inputMode="decimal" className="num text-lg" value={card} onChange={(e) => setCard(e.target.value)} />
                  <InputGroupAddon align="inline-end">DH</InputGroupAddon>
                </InputGroup>
                <FieldDescription />
              </Field>
            )}
            <Button size="lg" className="h-12" onClick={() => void review()} disabled={busy || outbox.pending > 0}>
              {busy && <Loader2 className="animate-spin" />}
              {t("next")}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === "review" && preview && (
        <Card>
          <CardHeader>
            <CardTitle>{t("reviewTitle")}</CardTitle>
            <CardDescription>{t("tickets", { count: preview.tickets })}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("mode")}</TableHead>
                  <TableHead className="text-end">{t("expected")}</TableHead>
                  <TableHead className="text-end">{t("counted")}</TableHead>
                  <TableHead className="text-end">{t("difference")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.expected.map((row) => {
                  const c = counted[row.mode_of_payment] ?? 0;
                  const diff = fromCents(toCents(c) - toCents(row.expected));
                  return (
                    <TableRow key={row.mode_of_payment}>
                      <TableCell>{row.mode_of_payment}</TableCell>
                      <TableCell className="num text-end">{money(row.expected)}</TableCell>
                      <TableCell className="num text-end">{money(c)}</TableCell>
                      <TableCell className="text-end">
                        <Badge
                          variant={diff === 0 ? "secondary" : "destructive"}
                          className={cn("num", diff === 0 && "bg-success/15 text-success")}
                        >
                          {diff > 0 ? "+" : ""}
                          {money(diff)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {preview.cash_outs.length > 0 && <CashOutList items={preview.cash_outs} />}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="lg" onClick={() => setStep("count")}>
                {t("back")}
              </Button>
              <Button size="lg" onClick={() => void close()} disabled={busy || outbox.pending > 0}>
                {busy && <Loader2 className="animate-spin" />}
                {t("confirmClose")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ZDone({ report, onNewDay }: { report: ZReport; onNewDay: () => void }) {
  const t = useTranslations("till.z");
  return (
    <div className="mx-auto grid w-full max-w-md gap-4">
      <Alert>
        <Lock />
        <AlertDescription>{t("locked")}</AlertDescription>
      </Alert>
      <div className="print-area print-receipt overflow-hidden rounded-xl border">
        <ZReportView report={report} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="lg" onClick={printReceipt}>
          <Printer /> {t("print")}
        </Button>
        <Button size="lg" onClick={onNewDay}>
          {t("newDay")}
        </Button>
      </div>
    </div>
  );
}

function CashOutList({ items }: { items: CashOut[] }) {
  const t = useTranslations("till.cashOut");
  const { money } = useFormat();
  return (
    <div className="grid gap-1 text-sm">
      <p className="text-muted-foreground font-medium">{t("list")}</p>
      <ul className="grid gap-1">
        {items.map((c) => (
          <li key={c.name} className="flex justify-between gap-3">
            <span className="truncate">
              {c.reason} <span className="text-muted-foreground">· {c.by}</span>
            </span>
            <span className="num shrink-0">−{money(c.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CashOutDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (list: CashOut[]) => void;
}) {
  const t = useTranslations("till.cashOut");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const value = parseAmount(amount);

  const save = async () => {
    if (!value || !reason.trim()) return;
    setBusy(true);
    try {
      const result = await rpc<{ cash_outs: CashOut[] }>("pos.record_cash_out", { amount: value, reason }, true);
      toast.success(t("saved"));
      setAmount("");
      setReason("");
      onSaved(result.cash_outs);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field>
            <FieldLabel htmlFor="co-amount">{t("amount")}</FieldLabel>
            <InputGroup className="h-11">
              <InputGroupInput id="co-amount" autoFocus inputMode="decimal" className="num text-lg" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <InputGroupAddon align="inline-end">DH</InputGroupAddon>
            </InputGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="co-reason">{t("reason")}</FieldLabel>
            <Input id="co-reason" className="h-11" placeholder={t("reasonPlaceholder")} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button type="submit" size="lg" disabled={busy || !value || !reason.trim()}>
            {busy && <Loader2 className="animate-spin" />}
            {t("save")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
