"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ProductPicker } from "@/components/purchasing/product-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { rpc } from "@/lib/api-client";
import type { ReceivingItem } from "@/lib/purchasing/types";
import type { ItemBatch, LocationRole, WriteOffReason } from "@/lib/stock/types";

type Mode = "transfer" | "write_off";

interface Line {
  key: string;
  item_code: string;
  item_name: string;
  has_batch_no: 0 | 1;
  qty: string;
  batch_no: string;
  batches: ItemBatch[];
}

const AUTO = "__auto__";

export interface TransferPrefill {
  mode?: Mode;
  reason?: WriteOffReason;
  item?: string;
  batch?: string;
  qty?: string;
  from?: LocationRole;
}

export function TransfersView({ prefill }: { prefill: TransferPrefill }) {
  const t = useTranslations("stock.transfers");
  const ts = useTranslations("stock");
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>(prefill.mode ?? "transfer");
  const [source, setSource] = useState<LocationRole>(prefill.from ?? (prefill.mode === "write_off" ? "shop_floor" : "back_store"));
  const [target, setTarget] = useState<LocationRole>("shop_floor");
  const [reason, setReason] = useState<WriteOffReason>(prefill.reason ?? "breakage");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  const batchesOf = (itemCode: string, location: LocationRole) =>
    rpc<ItemBatch[]>("stock.item_batches", { item_code: itemCode, warehouse_role: location });

  const add = async (item: ReceivingItem, qty = "1", batchNo = "") => {
    if (lines.some((l) => l.item_code === item.item_code && !batchNo)) {
      setLines((ls) => ls.map((l) => (l.item_code === item.item_code ? { ...l, qty: String(Number(l.qty) + 1) } : l)));
      return;
    }
    const batches = item.has_batch_no ? await batchesOf(item.item_code, source) : [];
    setLines((ls) => [
      ...ls,
      {
        key: `${item.item_code}-${Date.now()}`,
        item_code: item.item_code,
        item_name: item.item_name,
        has_batch_no: item.has_batch_no,
        qty,
        batch_no: batchNo || (mode === "write_off" && batches[0] ? batches[0].batch_no : ""),
        batches,
      },
    ]);
  };

  // Coming from the expiry board: the expired lot is pre-filled.
  useEffect(() => {
    if (!prefill.item) return;
    const timer = window.setTimeout(async () => {
      const item = await rpc<ReceivingItem>("purchasing.find_receiving_item", { code: prefill.item });
      await add(item, prefill.qty ?? "1", prefill.batch ?? "");
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeSource = async (next: LocationRole) => {
    setSource(next);
    if (next === target) setTarget(next === "shop_floor" ? "back_store" : "shop_floor");
    const refreshed = await Promise.all(
      lines.map(async (l) => (l.has_batch_no ? { ...l, batch_no: "", batches: await batchesOf(l.item_code, next) } : l)),
    );
    setLines(refreshed);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const payload = lines.map((l) => ({ item_code: l.item_code, qty: Number(l.qty) || 0, batch_no: l.batch_no || undefined }));
      if (mode === "transfer") {
        await rpc("stock.transfer", { lines: payload, source, target }, true);
        toast.success(t("transferred"));
      } else {
        await rpc("stock.write_off", { lines: payload, reason, source, note }, true);
        toast.success(t("writtenOff"));
      }
      setLines([]);
      setNote("");
      await queryClient.invalidateQueries({ queryKey: ["stock"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const locations: LocationRole[] = ["shop_floor", "back_store", "quarantine"];

  return (
    <div className="mx-auto grid max-w-3xl gap-4 pb-24">
      <ToggleGroup type="single" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as Mode)} className="w-full">
        <ToggleGroupItem value="transfer" className="h-11 flex-1">
          {t("modeTransfer")}
        </ToggleGroupItem>
        <ToggleGroupItem value="write_off" className="h-11 flex-1">
          {t("modeWriteOff")}
        </ToggleGroupItem>
      </ToggleGroup>

      <Card>
        <CardContent className="grid gap-4 pt-6">
          {mode === "transfer" ? (
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <Field>
                <FieldLabel>{t("from")}</FieldLabel>
                <Select value={source} onValueChange={(v) => void changeSource(v as LocationRole)}>
                  <SelectTrigger className="h-11 w-full" aria-label={t("from")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => (
                      <SelectItem key={l} value={l}>
                        {ts(`locations.${l}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label={t("swap")}
                onClick={() => {
                  const s = source;
                  void changeSource(target);
                  setTarget(s);
                }}
              >
                <ArrowLeftRight />
              </Button>
              <Field>
                <FieldLabel>{t("to")}</FieldLabel>
                <Select value={target} onValueChange={(v) => setTarget(v as LocationRole)}>
                  <SelectTrigger className="h-11 w-full" aria-label={t("to")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {locations
                      .filter((l) => l !== source)
                      .map((l) => (
                        <SelectItem key={l} value={l}>
                          {ts(`locations.${l}`)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>{t("from")}</FieldLabel>
                <Select value={source} onValueChange={(v) => void changeSource(v as LocationRole)}>
                  <SelectTrigger className="h-11 w-full" aria-label={t("from")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => (
                      <SelectItem key={l} value={l}>
                        {ts(`locations.${l}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>{t("reason")}</FieldLabel>
                <ToggleGroup type="single" variant="outline" value={reason} onValueChange={(v) => v && setReason(v as WriteOffReason)} className="w-full flex-wrap">
                  {(["breakage", "theft", "expired", "tester"] as const).map((r) => (
                    <ToggleGroupItem key={r} value={r} className="h-11 flex-1">
                      {t(`reasons.${r}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="note">{t("note")}</FieldLabel>
                <Input id="note" className="h-11" value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-2">
        <p className="text-muted-foreground text-sm font-medium">{t("scan")}</p>
        <ProductPicker onPick={(item) => void add(item)} autoFocus={!prefill.item} />
      </div>

      <ul className="grid gap-2">
        {lines.map((l) => {
          const chosen = l.batches.find((b) => b.batch_no === l.batch_no);
          return (
            <li key={l.key} className="bg-card grid gap-2 rounded-xl border p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{l.item_name}</span>
                <Button variant="ghost" size="icon" className="size-10" aria-label={l.item_name} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                  <Trash2 />
                </Button>
              </div>
              <div className="grid grid-cols-[6rem_1fr] gap-2">
                <Field>
                  <FieldLabel htmlFor={`${l.key}-qty`} className="text-xs">
                    {t("qty")}
                  </FieldLabel>
                  <Input
                    id={`${l.key}-qty`}
                    inputMode="numeric"
                    className="num h-11"
                    value={l.qty}
                    onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value.replace(/\D/g, "") } : x)))}
                  />
                </Field>
                {l.has_batch_no === 1 && (
                  <Field>
                    <FieldLabel className="text-xs">{t("batch")}</FieldLabel>
                    <Select
                      value={l.batch_no || AUTO}
                      onValueChange={(v) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, batch_no: v === AUTO ? "" : v } : x)))}
                    >
                      <SelectTrigger className="h-11 w-full" aria-label={t("batch")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {mode === "transfer" && <SelectItem value={AUTO}>{t("batchAuto")}</SelectItem>}
                        {l.batches.map((b) => (
                          <SelectItem key={b.batch_no} value={b.batch_no}>
                            {b.lot} · {b.expiry_date ?? ts("counts.noExpiry")} · {t("available", { qty: b.qty })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </div>
              {chosen && Number(l.qty) > chosen.qty && (
                <p className="text-destructive text-xs">{t("available", { qty: chosen.qty })}</p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="bg-background/95 fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
        <Button
          size="lg"
          variant={mode === "write_off" ? "destructive" : "default"}
          className="h-12 w-full md:ms-auto md:flex md:w-auto"
          disabled={busy || !lines.length || lines.some((l) => !Number(l.qty) || (mode === "write_off" && l.has_batch_no === 1 && !l.batch_no))}
          onClick={() => void submit()}
        >
          {busy && <Loader2 className="animate-spin" />}
          {mode === "transfer" ? t("submitTransfer") : t("submitWriteOff")}
        </Button>
      </div>
    </div>
  );
}
