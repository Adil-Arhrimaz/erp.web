"use client";

import { Building2, Minus, Pause, Percent, Plus, ShoppingBasket, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useFormat } from "@/hooks/use-format";
import type { DocumentTotals } from "@/lib/money";
import { type Cart, effectiveDiscount } from "@/lib/pos/cart";
import { cn } from "@/lib/utils";

interface CartPanelProps {
  cart: Cart;
  totals: DocumentTotals;
  discountLimit: number | null;
  onQty: (itemCode: string, qty: number) => void;
  onLineDiscount: (itemCode: string, discount: number) => void;
  onCartDiscount: () => void;
  onPark: () => void;
  onPay: () => void;
  onClear: () => void;
  onCustomer: () => void;
  onRemoveCustomer: () => void;
}

export function CartPanel(props: CartPanelProps) {
  const { cart, totals } = props;
  const t = useTranslations("pos");
  const { moneyCents, money } = useFormat();

  return (
    <div className="bg-card flex h-full min-h-0 flex-col rounded-xl border">
      <div className="grid gap-2 border-b px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{t("cart")}</h2>
          <span className="text-muted-foreground text-sm">
            {t("cartCount", { count: cart.lines.reduce((s, l) => s + l.qty, 0) })}
          </span>
        </div>
        {cart.customer ? (
          <div className="bg-accent flex items-center gap-2 rounded-lg py-1 ps-3 pe-1 text-sm">
            <Building2 className="size-4 shrink-0" />
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate font-medium">{cart.customer.customer_name}</span>
              <span className="text-muted-foreground num text-xs">
                {cart.customer.pp_ice ? `ICE ${cart.customer.pp_ice}` : cart.customer.pp_phone}
              </span>
            </span>
            <Button variant="ghost" size="icon" className="size-10" aria-label={t("customer.remove")} onClick={props.onRemoveCustomer}>
              <X />
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="h-10 justify-start" onClick={props.onCustomer}>
            <Building2 /> {t("customer.button")}
          </Button>
        )}
      </div>

      {cart.lines.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShoppingBasket />
            </EmptyMedia>
            <EmptyDescription>{t("emptyCart")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-y-auto" aria-label={t("cart")}>
          {cart.lines.map((line, i) => {
            const discount = effectiveDiscount(line, cart.cartDiscount);
            return (
              <li key={line.item_code} className="grid gap-1.5 px-4 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="grid min-w-0">
                    <span className="text-sm leading-tight font-medium">{line.item_name}</span>
                    <span className="text-muted-foreground num text-xs">
                      {line.qty} × {money(line.price)}
                      {discount > 0.001 && (
                        <span className="text-success ms-1 font-medium">−{Number(discount.toFixed(2))} %</span>
                      )}
                    </span>
                  </div>
                  <span className="num shrink-0 text-sm font-semibold">{moneyCents(totals.lines[i]?.amount ?? 0)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-11"
                    aria-label={t("decrease")}
                    onClick={() => props.onQty(line.item_code, line.qty - 1)}
                  >
                    <Minus />
                  </Button>
                  <Input
                    aria-label={t("qty")}
                    inputMode="numeric"
                    className="num h-11 w-12 text-center"
                    value={line.qty}
                    onChange={(e) => {
                      const qty = Number.parseInt(e.target.value, 10);
                      if (Number.isFinite(qty) && qty >= 0) props.onQty(line.item_code, qty);
                    }}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-11"
                    aria-label={t("increase")}
                    onClick={() => props.onQty(line.item_code, line.qty + 1)}
                  >
                    <Plus />
                  </Button>
                  <span className="flex-1" />
                  <DiscountPopover
                    label={t("lineDiscount")}
                    value={line.discount}
                    limit={props.discountLimit}
                    onApply={(d) => props.onLineDiscount(line.item_code, d)}
                    trigger={
                      <Button variant="ghost" size="icon" className="size-11" aria-label={t("lineDiscount")}>
                        <Percent />
                      </Button>
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground size-11"
                    aria-label={t("remove", { name: line.item_name })}
                    onClick={() => props.onQty(line.item_code, 0)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid gap-2 border-t px-4 py-3">
        <dl className="num grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-sm">
          <dt className="text-muted-foreground">{t("subtotalHt")}</dt>
          <dd className="text-end">{moneyCents(totals.ht)}</dd>
          {totals.byRate.map((r) => (
            <div key={r.vatRate} className="contents">
              <dt className="text-muted-foreground">
                {r.vatRate ? t("vatLine", { rate: r.vatRate }) : t("vatExempt")}
              </dt>
              <dd className="text-end">{moneyCents(r.vat)}</dd>
            </div>
          ))}
          {totals.rounding !== 0 && (
            <>
              <dt className="text-muted-foreground">{t("totalTtc")}</dt>
              <dd className="text-end">{moneyCents(totals.ttc)}</dd>
              <dt className="text-muted-foreground">{t("rounding")}</dt>
              <dd className="text-end" data-testid="cart-rounding">
                {moneyCents(totals.rounding)}
              </dd>
            </>
          )}
          <dt className="pt-1 text-lg font-semibold">{totals.rounding !== 0 ? t("due") : t("totalTtc")}</dt>
          <dd className="pt-1 text-end text-2xl font-bold" data-testid="cart-total">
            {moneyCents(totals.due)}
          </dd>
        </dl>
        <div className="grid grid-cols-[auto_auto_1fr] gap-2">
          <Button
            variant="outline"
            size="icon"
            className="size-12"
            onClick={props.onCartDiscount}
            disabled={!cart.lines.length}
            aria-label={t("cartDiscount")}
            title={`${t("cartDiscount")} (F8)`}
          >
            <Percent />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-12"
            onClick={props.onPark}
            disabled={!cart.lines.length}
            aria-label={t("park")}
            title={`${t("park")} (F6)`}
          >
            <Pause />
          </Button>
          <Button size="lg" className="h-12 text-base" onClick={props.onPay} disabled={!cart.lines.length}>
            {t("pay")}
            <Kbd className="bg-primary-foreground/20 text-primary-foreground ms-1 hidden lg:inline-flex">F9</Kbd>
          </Button>
        </div>
        {cart.cartDiscount > 0 && (
          <p className="text-success text-center text-xs font-medium">
            {t("cartDiscount")} : −{cart.cartDiscount} %
          </p>
        )}
        {cart.lines.length > 0 && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={props.onClear}>
            {t("clear")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function DiscountPopover({
  label,
  value,
  limit,
  onApply,
  trigger,
}: {
  label: string;
  value: number;
  limit: number | null;
  onApply: (discount: number) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-64" align="end">
        {open && (
          <DiscountForm
            label={label}
            value={value}
            limit={limit}
            onApply={(d) => {
              onApply(d);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Percent discount with the role's limit; mounted fresh each time it opens. */
export function DiscountForm({
  label,
  value,
  limit,
  onApply,
}: {
  label: string;
  value: number;
  limit: number | null;
  onApply: (discount: number) => void;
}) {
  const t = useTranslations("pos");
  const [draft, setDraft] = useState(value ? String(value) : "");
  const parsed = draft.trim() === "" ? 0 : Number(draft.replace(",", "."));
  const invalid = !Number.isFinite(parsed) || parsed < 0 || parsed > 100;
  const tooHigh = limit !== null && parsed > limit;

  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid && !tooHigh) onApply(parsed);
      }}
    >
      <label className="text-sm font-medium" htmlFor="discount-input">
        {label}
      </label>
      <Input
        id="discount-input"
        autoFocus
        inputMode="decimal"
        className={cn("num h-11 text-lg", (invalid || tooHigh) && "border-destructive")}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      {limit !== null && (
        <p className={cn("text-xs", tooHigh ? "text-destructive" : "text-muted-foreground")}>
          {tooHigh ? t("discountTooHigh", { limit }) : t("discountLimit", { limit })}
        </p>
      )}
      <Button type="submit" disabled={invalid || tooHigh}>
        {t("apply")}
      </Button>
    </form>
  );
}
