"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useFormat } from "@/hooks/use-format";
import { rpc } from "@/lib/api-client";
import { isValidIce, normalizeIce } from "@/lib/legal-ids";
import type { Supplier } from "@/lib/purchasing/types";

import { useSuppliers } from "./supplier-select";

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function SuppliersView({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations("purchasing.suppliers");
  const tc = useTranslations("purchasing.common");
  const { money } = useFormat();
  const suppliers = useSuppliers();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Partial<Supplier> | null>(null);
  const q = normalize(search.trim());
  const rows = (suppliers.data ?? []).filter(
    (s) => !q || normalize(s.supplier_name).includes(q) || (s.pp_ice ?? "").includes(q),
  );

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <InputGroup className="h-11 sm:max-w-sm">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput type="search" placeholder={t("search")} aria-label={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </InputGroup>
        {canEdit && (
          <Button size="lg" className="h-11 sm:ms-auto" onClick={() => setEditing({})}>
            <Plus /> {t("new")}
          </Button>
        )}
      </div>

      {suppliers.isPending ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{tc("empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <ul className="grid gap-2 md:hidden">
            {rows.map((s) => (
              <li key={s.name}>
                <button
                  type="button"
                  className="bg-card hover:bg-accent flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-start"
                  onClick={() => canEdit && setEditing(s)}
                >
                  <span className="grid min-w-0 gap-1">
                    <span className="truncate font-medium">{s.supplier_name}</span>
                    {s.pp_ice && <span className="text-muted-foreground num text-xs">ICE {s.pp_ice}</span>}
                  </span>
                  {!!s.outstanding && <span className="num shrink-0 font-semibold">{money(s.outstanding)}</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="bg-card hidden overflow-hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("name")}</TableHead>
                  <TableHead>{t("ice")}</TableHead>
                  <TableHead className="text-end">{t("leadTime")}</TableHead>
                  <TableHead className="text-end">{t("outstanding")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.name} className={canEdit ? "cursor-pointer" : undefined} onClick={() => canEdit && setEditing(s)}>
                    <TableCell className="font-medium">{s.supplier_name}</TableCell>
                    <TableCell className="num">{s.pp_ice}</TableCell>
                    <TableCell className="num text-end">{s.pp_lead_time_days || ""}</TableCell>
                    <TableCell className="num text-end">{s.outstanding ? money(s.outstanding) : ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{editing?.name ? t("edit") : t("new")}</SheetTitle>
          </SheetHeader>
          {editing && <SupplierForm key={editing.name ?? "new"} initial={editing} onSaved={() => setEditing(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SupplierForm({ initial, onSaved }: { initial: Partial<Supplier>; onSaved: () => void }) {
  const t = useTranslations("purchasing.suppliers");
  const tc = useTranslations("purchasing.common");
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    supplier_name: initial.supplier_name ?? "",
    pp_ice: initial.pp_ice ?? "",
    pp_if: initial.pp_if ?? "",
    pp_min_order_amount: initial.pp_min_order_amount ? String(initial.pp_min_order_amount) : "",
    pp_lead_time_days: initial.pp_lead_time_days ? String(initial.pp_lead_time_days) : "",
    pp_free_unit_terms: initial.pp_free_unit_terms ?? "",
  });
  const [busy, setBusy] = useState(false);
  const iceInvalid = !!form.pp_ice.trim() && !isValidIce(form.pp_ice);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    setBusy(true);
    try {
      await rpc(
        "purchasing.save_supplier",
        {
          supplier: {
            name: initial.name,
            ...form,
            pp_ice: form.pp_ice ? normalizeIce(form.pp_ice) : null,
            pp_min_order_amount: Number(form.pp_min_order_amount.replace(",", ".")) || 0,
            pp_lead_time_days: Number.parseInt(form.pp_lead_time_days, 10) || 0,
          },
        },
        true,
      );
      await queryClient.invalidateQueries({ queryKey: ["purchasing", "suppliers"] });
      toast.success(t("saved"));
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-4 px-4 pb-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (form.supplier_name.trim() && !iceInvalid) void save();
      }}
    >
      <Field>
        <FieldLabel htmlFor="s-name">{t("name")}</FieldLabel>
        <Input id="s-name" autoFocus className="h-11" value={form.supplier_name} onChange={set("supplier_name")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={iceInvalid}>
          <FieldLabel htmlFor="s-ice">{t("ice")}</FieldLabel>
          <Input id="s-ice" inputMode="numeric" className="num h-11" value={form.pp_ice} onChange={set("pp_ice")} aria-invalid={iceInvalid} />
          {iceInvalid && <FieldError>{t("iceInvalid")}</FieldError>}
        </Field>
        <Field>
          <FieldLabel htmlFor="s-if">{t("if")}</FieldLabel>
          <Input id="s-if" className="num h-11" value={form.pp_if} onChange={set("pp_if")} />
        </Field>
        <Field>
          <FieldLabel htmlFor="s-min">{t("minOrder")}</FieldLabel>
          <Input id="s-min" inputMode="decimal" className="num h-11" value={form.pp_min_order_amount} onChange={set("pp_min_order_amount")} />
        </Field>
        <Field>
          <FieldLabel htmlFor="s-lead">{t("leadTime")}</FieldLabel>
          <Input id="s-lead" inputMode="numeric" className="num h-11" value={form.pp_lead_time_days} onChange={set("pp_lead_time_days")} />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="s-free">{t("freeUnits")}</FieldLabel>
        <Textarea id="s-free" value={form.pp_free_unit_terms} onChange={set("pp_free_unit_terms")} />
      </Field>
      <Button type="submit" size="lg" disabled={busy || !form.supplier_name.trim() || iceInvalid}>
        {busy && <Loader2 className="animate-spin" />}
        {busy ? tc("saving") : tc("save")}
      </Button>
    </form>
  );
}
