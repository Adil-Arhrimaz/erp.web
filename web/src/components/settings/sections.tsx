"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, Loader2, Plus, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFormat } from "@/hooks/use-format";
import { rpc } from "@/lib/api-client";
import { TEMPLATE_HEADERS, parseCsv } from "@/lib/csv";
import { isValidIce, normalizeIce } from "@/lib/legal-ids";

export interface SettingsData {
  company: {
    name: string;
    company_name: string;
    abbr: string;
    ice: string | null;
    if: string | null;
    rc: string | null;
    tp: string | null;
    phone: string | null;
    address_line1: string | null;
    city: string | null;
  } | null;
  settings: Record<string, string | number | null>;
  vat_confirmed_by: string | null;
  vat_confirmed_on: string | null;
  templates: { name: string; title: string; rate: number }[];
  item_groups: { name: string; vat_template: string | null; item_count: number }[];
  warehouses: Record<"shop_floor" | "back_store" | "quarantine", string | null>;
  tills: { name: string; disabled: 0 | 1; warehouse: string }[];
  steps_done: string[];
  steps: string[];
  can_edit_vat: boolean;
  is_owner: boolean;
}

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: () => rpc<SettingsData>("settings.get_all") });
}

/** Calls a settings method and puts the fresh settings in the cache. */
function useSave() {
  const queryClient = useQueryClient();
  const t = useTranslations("settings");
  const [busy, setBusy] = useState(false);
  const save = async (method: string, args: Record<string, unknown>, quiet = false) => {
    setBusy(true);
    try {
      const result = await rpc<SettingsData>(method, args, true);
      queryClient.setQueryData(["settings"], result);
      if (!quiet) toast.success(t("saved"));
      return result;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { save, busy };
}

const text = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function CompanySection({ data }: { data: SettingsData }) {
  const t = useTranslations("settings.company");
  const ts = useTranslations("settings");
  const tsu = useTranslations("setup");
  const tsup = useTranslations("purchasing.suppliers");
  const { save, busy } = useSave();
  const c = data.company;
  const [form, setForm] = useState({
    company_name: c?.company_name ?? "",
    abbr: c?.abbr ?? "",
    ice: c?.ice ?? "",
    if: c?.if ?? "",
    rc: c?.rc ?? "",
    tp: c?.tp ?? "",
    phone: c?.phone ?? "",
    address_line1: c?.address_line1 ?? "",
    city: c?.city ?? "",
  });
  const iceBad = !!form.ice && !isValidIce(form.ice);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const input = (k: keyof typeof form, label: string, extra?: React.ComponentProps<typeof Input>) => (
    <Field data-invalid={k === "ice" && iceBad}>
      <FieldLabel htmlFor={`co-${k}`}>{label}</FieldLabel>
      <Input id={`co-${k}`} className="h-10" value={form[k]} onChange={set(k)} disabled={!data.is_owner} {...extra} />
      {k === "ice" && iceBad && <FieldError>{tsup("iceInvalid")}</FieldError>}
    </Field>
  );

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (iceBad) return;
        if (!c) void save("settings.create_shop", { company_name: form.company_name, abbr: form.abbr, ice: normalizeIce(form.ice), if_: form.if, rc: form.rc, tp: form.tp });
        else void save("settings.save_company", { values: { ...form, ice: normalizeIce(form.ice) } });
      }}
    >
      {!c && input("company_name", t("name"))}
      {!c && input("abbr", t("abbr"), { maxLength: 5 })}
      {c && (
        <p className="text-muted-foreground sm:col-span-2">
          {c.company_name} ({c.abbr})
        </p>
      )}
      {input("ice", t("ice"), { inputMode: "numeric", className: "num h-10" })}
      {input("if", t("if"))}
      {input("rc", t("rc"))}
      {input("tp", t("tp"))}
      {c && input("address_line1", t("address"))}
      {c && input("city", t("city"))}
      {c && input("phone", t("phone"), { type: "tel" })}
      {data.is_owner && (
        <Button type="submit" className="sm:col-span-2 sm:justify-self-end" disabled={busy || iceBad || (!c && (!form.company_name || !form.abbr || !form.ice))}>
          {busy && <Loader2 className="animate-spin" />}
          {busy && !c ? tsu("creating") : c ? ts("save") : tsu("create")}
        </Button>
      )}
    </form>
  );
}

export function VatSection({ data }: { data: SettingsData }) {
  const t = useTranslations("settings.vat");
  const tv = useTranslations("vat");
  const ts = useTranslations("settings");
  const { save, busy } = useSave();
  const { locale } = useFormat();
  const s = data.settings;
  const [form, setForm] = useState({
    vat_period: text(s.vat_period) || "Quarterly",
    vat_basis: text(s.vat_basis) || "Cash",
    vat_deadline_day: text(s.vat_deadline_day),
    cash_deduction_daily_limit: text(s.cash_deduction_daily_limit),
    cash_deduction_monthly_limit: text(s.cash_deduction_monthly_limit),
    stamp_duty_applies: Number(s.stamp_duty_applies) === 1,
  });
  const disabled = !data.can_edit_vat;

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel>{t("period")}</FieldLabel>
          <ToggleGroup type="single" variant="outline" disabled={disabled} value={form.vat_period} onValueChange={(v) => v && setForm((f) => ({ ...f, vat_period: v }))} className="w-full">
            <ToggleGroupItem value="Monthly" className="h-10 flex-1">{tv("monthly")}</ToggleGroupItem>
            <ToggleGroupItem value="Quarterly" className="h-10 flex-1">{tv("quarterly")}</ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel>{t("basis")}</FieldLabel>
          <ToggleGroup type="single" variant="outline" disabled={disabled} value={form.vat_basis} onValueChange={(v) => v && setForm((f) => ({ ...f, vat_basis: v }))} className="w-full">
            <ToggleGroupItem value="Cash" className="h-10 flex-1">{tv("basis.Cash")}</ToggleGroupItem>
            <ToggleGroupItem value="Invoice" className="h-10 flex-1">{tv("basis.Invoice")}</ToggleGroupItem>
          </ToggleGroup>
        </Field>
        {(["vat_deadline_day", "cash_deduction_daily_limit", "cash_deduction_monthly_limit"] as const).map((k) => (
          <Field key={k}>
            <FieldLabel htmlFor={k}>{t(k === "vat_deadline_day" ? "deadline" : k === "cash_deduction_daily_limit" ? "dailyLimit" : "monthlyLimit")}</FieldLabel>
            <Input id={k} inputMode="numeric" className="num h-10" disabled={disabled} value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
          </Field>
        ))}
        <Field orientation="horizontal">
          <FieldLabel htmlFor="stamp">{t("stampDuty")}</FieldLabel>
          <Switch id="stamp" disabled={disabled} checked={form.stamp_duty_applies} onCheckedChange={(v) => setForm((f) => ({ ...f, stamp_duty_applies: v }))} />
        </Field>
      </div>
      <p className="text-muted-foreground text-sm">
        {data.vat_confirmed_by && data.vat_confirmed_on
          ? t("confirmedBy", { user: data.vat_confirmed_by, date: new Date(data.vat_confirmed_on.replace(" ", "T")).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB") })
          : t("notConfirmed")}
      </p>
      {!disabled && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void save("settings.confirm_vat", {})}>
            <CheckCircle2 /> {t("confirm")}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void save("settings.save_settings", {
                values: {
                  ...form,
                  vat_deadline_day: Number(form.vat_deadline_day) || 20,
                  cash_deduction_daily_limit: Number(form.cash_deduction_daily_limit) || 5000,
                  cash_deduction_monthly_limit: Number(form.cash_deduction_monthly_limit) || 50000,
                  stamp_duty_applies: form.stamp_duty_applies ? 1 : 0,
                },
              })
            }
          >
            {busy && <Loader2 className="animate-spin" />}
            {ts("save")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function FamiliesSection({ data }: { data: SettingsData }) {
  const t = useTranslations("settings.families");
  const { save, busy } = useSave();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState(data.templates.find((x) => x.rate === 20 && !x.title.includes("frais"))?.name ?? "");
  const disabled = !data.can_edit_vat;
  const label = (tpl: { title: string }) => tpl.title;

  return (
    <div className="grid gap-3">
      <Alert>
        <AlertDescription>{t("borderline")}</AlertDescription>
      </Alert>
      <ul className="divide-y rounded-lg border">
        {data.item_groups.map((g) => (
          <li key={g.name} className="flex flex-wrap items-center justify-between gap-2 p-2 ps-3">
            <span className="grid">
              <span className="font-medium">{g.name}</span>
              <span className="text-muted-foreground text-xs">{t("items", { count: g.item_count })}</span>
            </span>
            <Select value={g.vat_template ?? ""} disabled={disabled || busy} onValueChange={(v) => void save("settings.set_family", { name: g.name, vat_template: v }, true)}>
              <SelectTrigger className="h-10 w-56" aria-label={g.name}>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {data.templates.map((tpl) => (
                  <SelectItem key={tpl.name} value={tpl.name}>
                    {label(tpl)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </li>
        ))}
      </ul>
      {!disabled && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && template) void save("settings.set_family", { name, vat_template: template, new: 1 }).then((r) => r && setName(""));
          }}
        >
          <Field className="min-w-48 flex-1">
            <FieldLabel htmlFor="new-family">{t("name")}</FieldLabel>
            <Input id="new-family" className="h-10" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Select value={template} onValueChange={setTemplate}>
            <SelectTrigger className="h-10 w-56" aria-label={t("name")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.templates.map((tpl) => (
                <SelectItem key={tpl.name} value={tpl.name}>
                  {label(tpl)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" variant="outline" disabled={busy || !name.trim()}>
            <Plus /> {t("add")}
          </Button>
        </form>
      )}
    </div>
  );
}

export function PosSection({ data }: { data: SettingsData }) {
  const t = useTranslations("settings.pos");
  const ts = useTranslations("settings");
  const { save, busy } = useSave();
  const s = data.settings;
  const [form, setForm] = useState({
    cashier_discount_limit: text(s.cashier_discount_limit),
    return_pin_threshold: text(s.return_pin_threshold),
    expiry_warning_days: text(s.expiry_warning_days),
    receipt_language: text(s.receipt_language) || "fr",
  });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(["cashier_discount_limit", "return_pin_threshold", "expiry_warning_days"] as const).map((k) => (
        <Field key={k}>
          <FieldLabel htmlFor={k}>{t(k === "cashier_discount_limit" ? "discount" : k === "return_pin_threshold" ? "pinThreshold" : "expiry")}</FieldLabel>
          <Input id={k} inputMode="decimal" className="num h-10" disabled={!data.is_owner} value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
        </Field>
      ))}
      <Field>
        <FieldLabel>{t("receiptLanguage")}</FieldLabel>
        <ToggleGroup type="single" variant="outline" disabled={!data.is_owner} value={form.receipt_language} onValueChange={(v) => v && setForm((f) => ({ ...f, receipt_language: v }))} className="w-full">
          <ToggleGroupItem value="fr" className="h-10 flex-1">Français</ToggleGroupItem>
          <ToggleGroupItem value="en" className="h-10 flex-1">English</ToggleGroupItem>
        </ToggleGroup>
      </Field>
      {data.is_owner && (
        <Button
          className="sm:col-span-2 sm:justify-self-end"
          disabled={busy}
          onClick={() =>
            void save("settings.save_settings", {
              values: {
                cashier_discount_limit: Number(form.cashier_discount_limit.replace(",", ".")) || 0,
                return_pin_threshold: Number(form.return_pin_threshold.replace(",", ".")) || 0,
                expiry_warning_days: Number(form.expiry_warning_days) || 90,
                receipt_language: form.receipt_language,
              },
            })
          }
        >
          {busy && <Loader2 className="animate-spin" />}
          {ts("save")}
        </Button>
      )}
    </div>
  );
}

export function LocationsSection({ data }: { data: SettingsData }) {
  const ts = useTranslations("stock.locations");
  return (
    <ul className="grid gap-1 text-sm">
      {(Object.entries(data.warehouses) as [keyof SettingsData["warehouses"], string | null][]).map(([role, name]) => (
        <li key={role} className="flex justify-between gap-3 rounded-lg border p-3">
          <span className="font-medium">{ts(role)}</span>
          <span className="text-muted-foreground">{name}</span>
        </li>
      ))}
    </ul>
  );
}

export function TillsSection({ data }: { data: SettingsData }) {
  const t = useTranslations("settings.tills");
  const { save, busy } = useSave();
  const [name, setName] = useState("");
  return (
    <div className="grid gap-3">
      <ul className="grid gap-1 text-sm">
        {data.tills.map((till) => (
          <li key={till.name} className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <span className="font-medium">{till.name}</span>
            {till.disabled ? <Badge variant="outline">{t("disabled")}</Badge> : <span className="text-muted-foreground">{till.warehouse}</span>}
          </li>
        ))}
      </ul>
      {data.is_owner && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void save("settings.create_till", { name }).then((r) => r && setName(""));
          }}
        >
          <Input className="h-10" placeholder={t("name")} aria-label={t("name")} value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="outline" disabled={busy || !name.trim()}>
            <Plus /> {t("add")}
          </Button>
        </form>
      )}
    </div>
  );
}

interface UserRow {
  name: string;
  full_name: string;
  enabled: 0 | 1;
  role: string | null;
  last_login: string | null;
}

export function UsersSection() {
  const t = useTranslations("settings.users");
  const tr = useTranslations("common.roles");
  const queryClient = useQueryClient();
  const { locale } = useFormat();
  const users = useQuery({ queryKey: ["settings", "users"], queryFn: () => rpc<UserRow[]>("settings.list_users") });
  const [form, setForm] = useState({ email: "", full_name: "", role: "cashier", password: "" });
  const [busy, setBusy] = useState(false);
  const roles = ["owner", "manager", "cashier", "stock_clerk", "accountant"];

  const call = async (method: string, args: Record<string, unknown>) => {
    setBusy(true);
    try {
      queryClient.setQueryData(["settings", "users"], await rpc<UserRow[]>(method, args, true));
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <ul className="divide-y rounded-lg border">
        {users.data?.map((u) => (
          <li key={u.name} className="flex flex-wrap items-center gap-2 p-2 ps-3">
            <span className="grid min-w-0 flex-1">
              <span className="truncate font-medium">
                {u.full_name} {!u.enabled && <Badge variant="outline">{t("disabled")}</Badge>}
              </span>
              <span className="text-muted-foreground truncate text-xs">
                {u.name} · {u.last_login ? t("lastLogin", { date: new Date(u.last_login.replace(" ", "T")).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB") }) : t("never")}
              </span>
            </span>
            <Select value={u.role ?? ""} onValueChange={(role) => void call("settings.update_user", { user: u.name, role })}>
              <SelectTrigger className="h-10 w-40" aria-label={`${t("role")} ${u.full_name}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {tr(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void call("settings.update_user", { user: u.name, enabled: u.enabled ? 0 : 1 })}>
              {u.enabled ? t("disable") : t("enable")}
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void call("settings.invite_user", form).then((ok) => ok && setForm({ email: "", full_name: "", role: "cashier", password: "" }));
        }}
      >
        <p className="font-medium sm:col-span-2">{t("invite")}</p>
        <Input className="h-10" placeholder={t("name")} aria-label={t("name")} value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
        <Input className="h-10" type="email" placeholder={t("email")} aria-label={t("email")} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        <Select value={form.role} onValueChange={(role) => setForm((f) => ({ ...f, role }))}>
          <SelectTrigger className="h-10 w-full" aria-label={t("role")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roles.map((r) => (
              <SelectItem key={r} value={r}>
                {tr(r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input className="h-10" type="text" autoComplete="new-password" placeholder={t("password")} aria-label={t("password")} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
        <Button type="submit" className="sm:col-span-2 sm:justify-self-end" disabled={busy || !form.email || !form.full_name || form.password.length < 8}>
          <Plus /> {t("invite")}
        </Button>
      </form>
    </div>
  );
}

// Product import --------------------------------------------------------------------------------------

export function ImportSection({ onImported }: { onImported?: () => void }) {
  const t = useTranslations("settings.import");
  const queryClient = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [check, setCheck] = useState<{ valid: number; errors: { line: number; name: string; errors: string[] }[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const template = () => {
    const example = ["Crème hydratante 50 ml", "Marque A", "Laboratoire A", "Visage", "6111000000014", "189,00", "5", "oui"];
    const csv = "﻿" + [TEMPLATE_HEADERS.join(";"), example.join(";")].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "parapilot-produits.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (f: File) => {
    setBusy(true);
    try {
      const parsed = parseCsv(await f.text());
      setRows(parsed);
      setCheck(await rpc("settings.import_products", { rows: parsed, dry_run: 1 }, true));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    setBusy(true);
    try {
      const result = await rpc<{ imported: number }>("settings.import_products", { rows, dry_run: 0 }, true);
      toast.success(t("done", { count: result.imported }));
      setRows([]);
      setCheck(null);
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      onImported?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3">
      <p className="text-muted-foreground text-sm">{t("hint")}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={template}>
          <Download /> {t("template")}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => file.current?.click()}>
          {busy ? <Loader2 className="animate-spin" /> : <Upload />} {t("choose")}
        </Button>
        <input
          ref={file}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          aria-label={t("choose")}
          data-testid="import-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {check && (
        <div className="grid gap-2">
          <p className="text-sm font-medium">{t("check", { valid: check.valid })}</p>
          {check.errors.length > 0 ? (
            <Alert variant="destructive">
              <AlertDescription className="grid gap-1">
                <strong>{t("errors")}</strong>
                <ul className="grid gap-0.5">
                  {check.errors.map((e) => (
                    <li key={e.line}>
                      {t("line", { line: e.line })} {e.name && `(${e.name})`} : {e.errors.join(", ")}
                    </li>
                  ))}
                </ul>
                <span>{t("fixFirst")}</span>
              </AlertDescription>
            </Alert>
          ) : (
            <Button className="justify-self-start" disabled={busy || !check.valid} onClick={() => void doImport()}>
              {busy && <Loader2 className="animate-spin" />}
              {t("import", { count: check.valid })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
