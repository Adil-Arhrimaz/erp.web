"use client";

import { useLiveQuery } from "dexie-react-hooks";
import {
  CloudOff,
  Loader2,
  PauseCircle,
  Printer,
  RefreshCw,
  ScanBarcode,
  ShoppingBasket,
  TriangleAlert,
  Wifi,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useSession } from "@/components/session-provider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useSidebar } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormat } from "@/hooks/use-format";
import {
  type Cart,
  addItem,
  buildSale,
  cartTotals,
  emptyCart,
  localReceipt,
  setLineDiscount,
  setQty,
} from "@/lib/pos/cart";
import { newClientId } from "@/lib/pos/client-id";
import { posDb } from "@/lib/pos/db";
import type { CatalogItem, TillStatus } from "@/lib/pos/types";
import { cn } from "@/lib/utils";

import { CartPanel, DiscountForm } from "./cart-panel";
import { CustomerDialog } from "./customer-dialog";
import { PaymentDialog } from "./payment-dialog";
import { Receipt, printReceipt } from "./receipt";
import { useOnline, useOutbox, usePosCatalog } from "./use-pos-data";

const ALL = "__all__";
const MAX_RESULTS = 60;

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function PosView({ status }: { status: TillStatus }) {
  const t = useTranslations("pos");
  const session = useSession();
  const opening = status.opening;

  if (!opening) {
    return (
      <Empty className="min-h-[60dvh]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShoppingBasket />
          </EmptyMedia>
          <EmptyTitle>{t("till.closedTitle")}</EmptyTitle>
          <EmptyDescription>{t("till.closedBody")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild size="lg">
            <Link href="/till">{t("till.open")}</Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  if (opening.outdated) {
    return (
      <Alert variant="destructive" className="mx-auto max-w-xl">
        <TriangleAlert />
        <AlertTitle>{t("till.outdatedTitle")}</AlertTitle>
        <AlertDescription className="grid gap-3">
          {t("till.outdatedBody")}
          <Button asChild variant="outline" className="justify-self-start">
            <Link href="/till">{t("till.close")}</Link>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  return <Till key={opening.name} posProfile={opening.pos_profile} status={status} user={session.user} />;
}

function Till({ posProfile, status, user }: { posProfile: string; status: TillStatus; user: string }) {
  const t = useTranslations("pos");
  const session = useSession();
  const { money, locale } = useFormat();
  const online = useOnline();
  const { catalog, error: catalogError, refresh, refreshing } = usePosCatalog(posProfile);
  const outbox = useOutbox(user);

  const [cart, setCart] = useState<Cart>(emptyCart);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState(ALL);
  const [payOpen, setPayOpen] = useState(false);
  const [cartDiscountOpen, setCartDiscountOpen] = useState(false);
  const [parkedOpen, setParkedOpen] = useState(false);
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [doneId, setDoneId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);
  const { setOpen: setSidebarOpen } = useSidebar();

  // At the counter the products and the cart need the width: fold the sidebar to icons on tablets.
  useEffect(() => {
    if (window.innerWidth < 1280) setSidebarOpen(false);
  }, [setSidebarOpen]);

  const parked = useLiveQuery(() => posDb.parked.where({ user }).sortBy("created_at"), [user]) ?? [];
  const done = useLiveQuery(() => (doneId ? posDb.outbox.get(doneId) : undefined), [doneId]);

  const taxRows = useMemo(() => catalog?.tax_rows ?? [20, 10], [catalog]);
  const method = catalog?.rounding_method ?? "Commercial Rounding";
  const roundTotal = catalog?.round_total ?? false;
  const totals = useMemo(() => cartTotals(cart, taxRows, method, roundTotal), [cart, taxRows, method, roundTotal]);

  const byBarcode = useMemo(() => {
    const map = new Map<string, CatalogItem>();
    for (const item of catalog?.items ?? []) {
      for (const code of item.barcodes) map.set(code, item);
      map.set(item.item_code, item);
    }
    return map;
  }, [catalog]);

  const groups = useMemo(
    () => [...new Set((catalog?.items ?? []).map((i) => i.item_group))].sort((a, b) => a.localeCompare(b)),
    [catalog],
  );

  const results = useMemo(() => {
    const q = normalize(deferredQuery.trim());
    const items = catalog?.items ?? [];
    const filtered = items.filter(
      (i) =>
        (group === ALL || i.item_group === group) &&
        (!q ||
          normalize(i.item_name).includes(q) ||
          (i.brand && normalize(i.brand).includes(q)) ||
          i.barcodes.some((b) => b.startsWith(q))),
    );
    return filtered.slice(0, MAX_RESULTS);
  }, [catalog, deferredQuery, group]);

  const focusSearch = useCallback(() => searchRef.current?.focus(), []);

  const add = useCallback(
    (item: CatalogItem) => {
      if (item.price === null) {
        toast.error(t("noPriceError", { name: item.item_name }));
        return;
      }
      const inCart = cart.lines.find((l) => l.item_code === item.item_code)?.qty ?? 0;
      if (item.stock !== null && inCart + 1 > item.stock) {
        toast.error(t("notEnoughStock", { count: Math.max(0, item.stock), name: item.item_name }));
        return;
      }
      setCart((c) => addItem(c, item));
    },
    [cart.lines, t],
  );

  const changeQty = (itemCode: string, qty: number) => {
    const item = byBarcode.get(itemCode);
    if (item && item.stock !== null && qty > item.stock) {
      toast.error(t("notEnoughStock", { count: Math.max(0, item.stock), name: item.item_name }));
      return;
    }
    setCart((c) => setQty(c, itemCode, qty));
  };

  // A scanner types the code and presses Enter.
  const onSearchEnter = () => {
    const code = query.trim();
    if (!code) return;
    const exact = byBarcode.get(code);
    if (exact) {
      add(exact);
      setQuery("");
      return;
    }
    if (results.length === 1) {
      add(results[0]);
      setQuery("");
      return;
    }
    if (/^\d{6,}$/.test(code)) {
      toast.error(t("unknownBarcode", { code }));
      setQuery("");
    }
  };

  const park = useCallback(async () => {
    if (!cart.lines.length) return;
    await posDb.parked.add({
      id: newClientId(),
      user,
      created_at: Date.now(),
      lines: cart.lines,
      cart_discount: cart.cartDiscount,
      customer: cart.customer,
    });
    setCart(emptyCart());
    focusSearch();
  }, [cart, user, focusSearch]);

  const resume = async (id: string) => {
    const entry = await posDb.parked.get(id);
    if (!entry) return;
    if (cart.lines.length) await park();
    await posDb.parked.delete(id);
    setCart({ lines: entry.lines, cartDiscount: entry.cart_discount, customer: entry.customer ?? null });
    setParkedOpen(false);
  };

  const completeSale = async (tender: { cash: number; card: number }) => {
    if (!catalog) return;
    const clientId = newClientId();
    const sale = buildSale({
      cart,
      totals,
      tender,
      modes: catalog.payment_modes,
      clientId,
      posProfile,
      soldAt: new Date(),
    });
    const receipt = localReceipt({ sale, cart, totals, cashier: session.full_name, company: catalog.company });
    // The sale is safe on the device first; sending to ERPNext happens right after, or when back online.
    await posDb.outbox.add({
      client_id: clientId,
      user,
      created_at: Date.now(),
      status: "pending",
      payload: sale,
      receipt,
      attempts: 0,
    });
    await posDb.catalog
      .where("key")
      .equals(posProfile)
      .modify((c) => {
        for (const line of cart.lines) {
          const item = c.items.find((i) => i.item_code === line.item_code);
          if (item && item.stock !== null) item.stock -= line.qty;
        }
      });
    setCart(emptyCart());
    setPayOpen(false);
    setCartSheetOpen(false);
    setDoneId(clientId);
    void outbox.sync();
  };

  // Keyboard: F2 search, F6 park, F8 cart discount, F9 pay, +/- on the last line.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (payOpen || doneId || cartDiscountOpen || parkedOpen || customerOpen) return;
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" && target !== searchRef.current;
      if (e.key === "F2") {
        e.preventDefault();
        focusSearch();
      } else if (e.key === "F9" || (e.key === "Enter" && e.ctrlKey)) {
        e.preventDefault();
        if (cart.lines.length) setPayOpen(true);
      } else if (e.key === "F6") {
        e.preventDefault();
        void park();
      } else if (e.key === "F8") {
        e.preventDefault();
        if (cart.lines.length) setCartDiscountOpen(true);
      } else if (!typing && !query && (e.key === "+" || e.key === "-") && cart.lines.length) {
        e.preventDefault();
        const last = cart.lines[cart.lines.length - 1];
        changeQty(last.item_code, last.qty + (e.key === "+" ? 1 : -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!catalog) {
    return catalogError ? (
      <Alert variant="destructive">
        <AlertTitle>{t("catalogError")}</AlertTitle>
        <AlertDescription>{catalogError}</AlertDescription>
      </Alert>
    ) : (
      <div className="grid gap-3" aria-busy>
        <p className="text-muted-foreground text-sm">{t("loadingCatalog")}</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  const fetchedAt = new Date(catalog.fetched_at).toLocaleTimeString(locale === "fr" ? "fr-FR" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const itemCount = cart.lines.reduce((s, l) => s + l.qty, 0);
  const cartPanel = (
    <CartPanel
      cart={cart}
      totals={totals}
      discountLimit={status.discount_limit}
      onQty={changeQty}
      onLineDiscount={(code, d) => setCart((c) => setLineDiscount(c, code, d))}
      onCartDiscount={() => setCartDiscountOpen(true)}
      onPark={() => void park()}
      onPay={() => setPayOpen(true)}
      onClear={() => setCart(emptyCart())}
      onCustomer={() => setCustomerOpen(true)}
      onRemoveCustomer={() => setCart((c) => ({ ...c, customer: null }))}
    />
  );

  return (
    <div className="-mx-4 -mt-4 grid gap-4 px-4 pt-4 md:-mx-6 md:h-[calc(100dvh-3.5rem)] md:grid-cols-[1fr_18rem] md:px-6 md:pb-4 lg:grid-cols-[1fr_22rem] xl:grid-cols-[1fr_24rem]">
      <section className="@container flex min-h-0 min-w-0 flex-col gap-3">
        <InputGroup className="h-12 shrink-0">
          <InputGroupAddon>
            <ScanBarcode />
          </InputGroupAddon>
          <InputGroupInput
            ref={searchRef}
            autoFocus
            type="search"
            className="text-base"
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSearchEnter();
              } else if (e.key === "Escape") {
                setQuery("");
              }
            }}
          />
        </InputGroup>

        <SyncLine
          online={online && !outbox.offline}
          pending={outbox.pending}
          failed={outbox.failed}
          othersPending={outbox.othersPending}
          catalogTime={fetchedAt}
          refreshing={refreshing}
          onSync={() => void outbox.sync()}
          onRefresh={() => void refresh()}
          parkedCount={parked.length}
          onShowParked={() => setParkedOpen(true)}
        />

        <div className="flex shrink-0 gap-2 overflow-x-auto pb-1" role="tablist">
          {[ALL, ...groups].map((g) => (
            <Button
              key={g}
              role="tab"
              aria-selected={group === g}
              variant={group === g ? "default" : "outline"}
              size="sm"
              className="h-10 shrink-0 rounded-full px-4"
              onClick={() => {
                setGroup(g);
                focusSearch();
              }}
            >
              {g === ALL ? t("allGroups") : g}
            </Button>
          ))}
        </div>

        <ul className="grid min-h-0 grid-cols-2 content-start gap-2 overflow-y-auto pb-24 @lg:grid-cols-3 @3xl:grid-cols-4 md:pb-0">
          {results.map((item) => {
            const out = item.stock !== null && item.stock <= 0;
            return (
              <li key={item.item_code}>
                <button
                  type="button"
                  onClick={() => {
                    add(item);
                    focusSearch();
                  }}
                  disabled={out || item.price === null}
                  className="bg-card hover:border-primary hover:bg-accent focus-visible:ring-ring flex h-full min-h-24 w-full flex-col justify-between gap-2 rounded-xl border p-3 text-start transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                >
                  <span className="line-clamp-2 text-sm leading-tight font-medium">{item.item_name}</span>
                  <span className="flex items-end justify-between gap-2">
                    <span className="text-muted-foreground truncate text-xs">{item.brand}</span>
                    <span className="num text-base font-semibold">
                      {item.price === null ? t("noPrice") : money(item.price)}
                    </span>
                  </span>
                  {out ? (
                    <Badge variant="destructive">{t("outOfStock")}</Badge>
                  ) : item.stock !== null && item.stock <= 3 ? (
                    <Badge className="bg-warning text-warning-foreground">{t("stockLeft", { count: item.stock })}</Badge>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <aside className="hidden min-h-0 md:block">{cartPanel}</aside>

      {/* Phones: the cart is a bottom sheet behind a summary bar. */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t bg-background/95 p-3 backdrop-blur md:hidden">
        <Button size="lg" className="h-12 w-full justify-between text-base" onClick={() => setCartSheetOpen(true)}>
          <span>{t("cartCount", { count: itemCount })}</span>
          <span className="num font-bold">{money(totals.due / 100)}</span>
        </Button>
      </div>
      <Sheet open={cartSheetOpen} onOpenChange={setCartSheetOpen}>
        <SheetContent side="bottom" className="h-[85dvh] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("cart")}</SheetTitle>
          </SheetHeader>
          {cartPanel}
        </SheetContent>
      </Sheet>

      <CustomerDialog
        open={customerOpen}
        onOpenChange={(o) => {
          setCustomerOpen(o);
          if (!o) focusSearch();
        }}
        onChoose={(customer) => setCart((c) => ({ ...c, customer }))}
      />

      <PaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        due={totals.due}
        hasCard={catalog.payment_modes.some((m) => m.type === "Bank")}
        onConfirm={completeSale}
      />

      <Dialog
        open={cartDiscountOpen}
        onOpenChange={(o) => {
          setCartDiscountOpen(o);
          if (!o) focusSearch();
        }}
      >
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>{t("cartDiscount")}</DialogTitle>
          </DialogHeader>
          <DiscountForm
            label={t("cartDiscount")}
            value={cart.cartDiscount}
            limit={status.discount_limit}
            onApply={(d) => {
              setCart((c) => ({ ...c, cartDiscount: d }));
              setCartDiscountOpen(false);
              focusSearch();
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={doneId !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDoneId(null);
            focusSearch();
          }
        }}
      >
        <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("done.title")}</DialogTitle>
            <DialogDescription className="flex items-center gap-2">
              {done?.receipt.change ? (
                <span className="num text-foreground text-2xl font-bold">
                  {t("done.change", { amount: money(done.receipt.change) })}
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {done && (
            <>
              <div className="print-area print-receipt overflow-hidden rounded-lg border">
                <Receipt receipt={done.receipt} language={catalog.receipt_language} />
              </div>
              <p className="text-muted-foreground flex items-center gap-2 text-xs">
                {done.status === "synced" ? (
                  <>
                    <Wifi className="text-success size-3.5" /> {t("ticket", { number: done.invoice ?? "" })}
                  </>
                ) : (
                  <>
                    <Loader2 className="size-3.5 animate-spin" /> {t("provisional")}
                  </>
                )}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="lg" onClick={printReceipt}>
                  <Printer /> {t("done.print")}
                </Button>
                <Button
                  size="lg"
                  autoFocus
                  onClick={() => {
                    setDoneId(null);
                    focusSearch();
                  }}
                >
                  {t("done.next")}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={parkedOpen} onOpenChange={setParkedOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("parked")}</DialogTitle>
          </DialogHeader>
          <ul className="grid gap-2">
            {parked.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="grid text-sm">
                  <span className="font-medium">{t("cartCount", { count: p.lines.reduce((s, l) => s + l.qty, 0) })}</span>
                  <span className="text-muted-foreground text-xs">
                    {t("parkedAt", {
                      time: new Date(p.created_at).toLocaleTimeString(locale === "fr" ? "fr-FR" : "en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                    })}
                  </span>
                </div>
                <Button onClick={() => void resume(p.id)}>{t("resume")}</Button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SyncLine(props: {
  online: boolean;
  pending: number;
  failed: number;
  othersPending: number;
  catalogTime: string;
  refreshing: boolean;
  onSync: () => void;
  onRefresh: () => void;
  parkedCount: number;
  onShowParked: () => void;
}) {
  const t = useTranslations("pos.sync");
  const tp = useTranslations("pos");
  return (
    <div className="grid shrink-0 gap-2">
      {!props.online && (
        <Alert className="border-warning bg-warning/10" role="status">
          <CloudOff />
          <AlertDescription className="text-foreground">{t("offline")}</AlertDescription>
        </Alert>
      )}
      {props.failed > 0 && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{t("failed", { count: props.failed })}</AlertDescription>
        </Alert>
      )}
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className={cn("flex items-center gap-1", props.online ? "text-success" : "text-warning-foreground")}>
          {props.online ? <Wifi className="size-3.5" /> : <CloudOff className="size-3.5" />}
          {props.online ? t("online") : null}
        </span>
        {props.pending > 0 && (
          <button type="button" className="text-foreground font-medium underline" onClick={props.onSync} data-testid="pending">
            {t("pending", { count: props.pending })}
          </button>
        )}
        {props.parkedCount > 0 && (
          <button type="button" className="text-foreground flex items-center gap-1 font-medium underline" onClick={props.onShowParked}>
            <PauseCircle className="size-3.5" /> {tp("parkedCount", { count: props.parkedCount })}
          </button>
        )}
        <span className="ms-auto flex items-center gap-1">
          {t("catalogAge", { time: props.catalogTime })}
          <button
            type="button"
            onClick={props.onRefresh}
            aria-label={t("refresh")}
            className="hover:text-foreground rounded p-1"
          >
            <RefreshCw className={cn("size-3.5", props.refreshing && "animate-spin")} />
          </button>
        </span>
      </div>
      {props.othersPending > 0 && <p className="text-muted-foreground text-xs">{t("otherUser", { count: props.othersPending })}</p>}
    </div>
  );
}
