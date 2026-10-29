"use client";

import { Banknote, CreditCard, Loader2, SplitSquareHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFormat } from "@/hooks/use-format";
import { type Cents, toCents } from "@/lib/money";
import type { Tender } from "@/lib/pos/cart";
import { cn } from "@/lib/utils";

type Method = "cash" | "card" | "mixed";

const parse = (v: string) => {
  const n = Number(v.replace(",", ".").replace(/\s/g, ""));
  return v.trim() === "" || !Number.isFinite(n) || n < 0 ? null : toCents(n);
};

/** Quick cash amounts: exact, then the next round amounts a customer typically hands over. */
function quickAmounts(due: Cents): Cents[] {
  const steps = [1000, 5000, 10000, 20000];
  const amounts = new Set<Cents>([due]);
  for (const step of steps) amounts.add(Math.ceil(due / step) * step);
  return [...amounts].filter((a) => a >= due).sort((a, b) => a - b).slice(0, 5);
}

export function PaymentDialog({
  open,
  onOpenChange,
  due,
  hasCard,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  due: Cents;
  hasCard: boolean;
  onConfirm: (tender: Tender) => Promise<void>;
}) {
  const t = useTranslations("pos.payment");
  const { moneyCents, locale } = useFormat();
  const [method, setMethod] = useState<Method>("cash");
  const [received, setReceived] = useState("");
  const [cardPart, setCardPart] = useState("");
  const [busy, setBusy] = useState(false);

  const receivedCents = parse(received) ?? 0;
  const cardCents = Math.min(parse(cardPart) ?? 0, due);
  const decimal = (c: Cents) => (c / 100).toFixed(2).replace(".", locale === "fr" ? "," : ".");

  let tender: Tender | null = null;
  if (method === "card") tender = { cash: 0, card: due / 100 };
  else if (method === "cash" && receivedCents >= due) tender = { cash: receivedCents / 100, card: 0 };
  else if (method === "mixed" && cardCents > 0 && cardCents <= due) tender = { cash: (due - cardCents) / 100, card: cardCents / 100 };

  const confirm = async () => {
    if (!tender || busy) return;
    setBusy(true);
    try {
      await onConfirm(tender);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setMethod("cash");
          setReceived("");
          setCardPart("");
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription className="flex items-baseline justify-between">
            <span>{t("due")}</span>
            <span className="num text-foreground text-3xl font-bold">{moneyCents(due)}</span>
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <ToggleGroup
            type="single"
            variant="outline"
            value={method}
            onValueChange={(v) => v && setMethod(v as Method)}
            className="w-full"
          >
            <ToggleGroupItem value="cash" className="h-12 flex-1 gap-2">
              <Banknote /> {t("cash")}
            </ToggleGroupItem>
            {hasCard && (
              <ToggleGroupItem value="card" className="h-12 flex-1 gap-2">
                <CreditCard /> {t("card")}
              </ToggleGroupItem>
            )}
            {hasCard && (
              <ToggleGroupItem value="mixed" className="h-12 flex-1 gap-2">
                <SplitSquareHorizontal /> {t("mixed")}
              </ToggleGroupItem>
            )}
          </ToggleGroup>

          {method === "cash" && (
            <div className="grid gap-3">
              <label htmlFor="received" className="text-sm font-medium">
                {t("received")}
              </label>
              <InputGroup className="h-14">
                <InputGroupInput
                  id="received"
                  autoFocus
                  inputMode="decimal"
                  className="num text-2xl font-semibold"
                  value={received}
                  onChange={(e) => setReceived(e.target.value)}
                />
                <InputGroupAddon align="inline-end">DH</InputGroupAddon>
              </InputGroup>
              <div className="flex flex-wrap gap-2">
                {quickAmounts(due).map((amount, i) => (
                  <Button
                    key={amount}
                    type="button"
                    variant="secondary"
                    className="num h-11 flex-1"
                    onClick={() => setReceived(decimal(amount))}
                  >
                    {i === 0 ? t("exact") : moneyCents(amount)}
                  </Button>
                ))}
              </div>
              <div
                className={cn(
                  "flex items-baseline justify-between rounded-lg p-3",
                  receivedCents >= due ? "bg-success/10" : "bg-muted",
                )}
              >
                <span className="text-sm font-medium">
                  {receivedCents >= due || !received ? t("change") : t("missing", { amount: moneyCents(due - receivedCents) })}
                </span>
                <span className="num text-3xl font-bold" data-testid="change">
                  {receivedCents >= due ? moneyCents(receivedCents - due) : "–"}
                </span>
              </div>
            </div>
          )}

          {method === "card" && <p className="text-muted-foreground text-sm">{t("cardHint")}</p>}

          {method === "mixed" && (
            <div className="grid gap-3">
              <label htmlFor="card-part" className="text-sm font-medium">
                {t("cardAmount")}
              </label>
              <InputGroup className="h-12">
                <InputGroupInput
                  id="card-part"
                  autoFocus
                  inputMode="decimal"
                  className="num text-xl"
                  value={cardPart}
                  onChange={(e) => setCardPart(e.target.value)}
                />
                <InputGroupAddon align="inline-end">DH</InputGroupAddon>
              </InputGroup>
              <div className="bg-muted flex items-baseline justify-between rounded-lg p-3">
                <span className="text-sm font-medium">{t("cashAmount")}</span>
                <span className="num text-2xl font-bold">{moneyCents(Math.max(0, due - cardCents))}</span>
              </div>
            </div>
          )}

          <Button type="submit" size="lg" className="h-14 text-lg" disabled={!tender || busy}>
            {busy && <Loader2 className="animate-spin" />}
            {t("confirm")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
