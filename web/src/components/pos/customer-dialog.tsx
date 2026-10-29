"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, Loader2, Plus, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { rpc } from "@/lib/api-client";
import { isValidIce, normalizeIce } from "@/lib/legal-ids";
import type { BusinessCustomer } from "@/lib/pos/types";

import { useOnline } from "./use-pos-data";

/** Choose or create the company a sale is invoiced to (name, address, ICE). Needs the connection. */
export function CustomerDialog({
  open,
  onOpenChange,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (customer: BusinessCustomer) => void;
}) {
  const t = useTranslations("pos.customer");
  const online = useOnline();
  const [kind, setKind] = useState<"individual" | "business">("individual");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const deferred = useDeferredValue(query.trim());

  const results = useQuery({
    queryKey: ["pos", "customers", kind, deferred],
    queryFn: () =>
      kind === "business"
        ? rpc<BusinessCustomer[]>("pos.search_customers", { query: deferred })
        : rpc<BusinessCustomer[]>("customers.search", { query: deferred }),
    enabled: open && online && !creating && (kind === "business" || deferred.length >= 2),
  });

  const choose = (c: BusinessCustomer) => {
    onChoose(c);
    onOpenChange(false);
    setQuery("");
    setCreating(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>
        {!online ? (
          <Alert>
            <AlertDescription>{t("offline")}</AlertDescription>
          </Alert>
        ) : (
          <div className="grid gap-3">
            <ToggleGroup
              type="single"
              variant="outline"
              value={kind}
              onValueChange={(v) => {
                if (!v) return;
                setKind(v as "individual" | "business");
                setCreating(false);
              }}
              className="w-full"
            >
              <ToggleGroupItem value="individual" className="h-11 flex-1">
                <User /> {t("tabIndividual")}
              </ToggleGroupItem>
              <ToggleGroupItem value="business" className="h-11 flex-1">
                <Building2 /> {t("tabBusiness")}
              </ToggleGroupItem>
            </ToggleGroup>
            {creating ? (
              kind === "business" ? (
                <NewCustomerForm onCreated={choose} onCancel={() => setCreating(false)} initialName={query} />
              ) : (
                <NewIndividualForm onCreated={choose} onCancel={() => setCreating(false)} initial={query} />
              )
            ) : (
          <div className="grid gap-3">
            <Input
              autoFocus
              className="h-11"
              placeholder={kind === "business" ? t("search") : t("searchIndividual")}
              aria-label={kind === "business" ? t("search") : t("searchIndividual")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul className="grid max-h-72 gap-1 overflow-y-auto">
              {results.data?.map((c) => (
                <li key={c.name}>
                  <button
                    type="button"
                    onClick={() => choose(c)}
                    className="hover:bg-accent flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-start"
                  >
                    {c.pp_ice ? (
                      <Building2 className="text-muted-foreground size-4 shrink-0" />
                    ) : (
                      <User className="text-muted-foreground size-4 shrink-0" />
                    )}
                    <span className="grid min-w-0">
                      <span className="truncate font-medium">{c.customer_name}</span>
                      <span className="text-muted-foreground num text-xs">{c.pp_ice ? `ICE ${c.pp_ice}` : c.pp_phone}</span>
                    </span>
                  </button>
                </li>
              ))}
              {results.data?.length === 0 && <li className="text-muted-foreground px-3 py-2 text-sm">{t("none")}</li>}
              {results.isFetching && <Loader2 className="text-muted-foreground mx-auto size-4 animate-spin" />}
            </ul>
            <Button variant="outline" onClick={() => setCreating(true)}>
              <Plus /> {t("create")}
            </Button>
          </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewCustomerForm({
  onCreated,
  onCancel,
  initialName,
}: {
  onCreated: (c: BusinessCustomer) => void;
  onCancel: () => void;
  initialName: string;
}) {
  const t = useTranslations("pos.customer");
  const tc = useTranslations("common");
  const ts = useTranslations("purchasing.suppliers");
  const [form, setForm] = useState({ customer_name: /^\d/.test(initialName) ? "" : initialName, ice: "", address_line1: "", city: "" });
  const [busy, setBusy] = useState(false);
  const iceOk = isValidIce(form.ice);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    try {
      onCreated(
        await rpc<BusinessCustomer>("pos.create_business_customer", { ...form, ice: normalizeIce(form.ice) }, true),
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (iceOk && form.customer_name.trim()) void submit();
      }}
    >
      <Field>
        <FieldLabel htmlFor="c-name">{t("name")}</FieldLabel>
        <Input id="c-name" autoFocus className="h-11" value={form.customer_name} onChange={set("customer_name")} />
      </Field>
      <Field data-invalid={!!form.ice && !iceOk}>
        <FieldLabel htmlFor="c-ice">{t("ice")}</FieldLabel>
        <Input id="c-ice" inputMode="numeric" className="num h-11" value={form.ice} onChange={set("ice")} aria-invalid={!!form.ice && !iceOk} />
        {form.ice && !iceOk && <FieldError>{ts("iceInvalid")}</FieldError>}
      </Field>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Field>
          <FieldLabel htmlFor="c-address">{t("address")}</FieldLabel>
          <Input id="c-address" className="h-11" value={form.address_line1} onChange={set("address_line1")} />
        </Field>
        <Field>
          <FieldLabel htmlFor="c-city">{t("city")}</FieldLabel>
          <Input id="c-city" className="h-11" value={form.city} onChange={set("city")} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button type="submit" disabled={busy || !iceOk || !form.customer_name.trim()}>
          {busy && <Loader2 className="animate-spin" />}
          {t("save")}
        </Button>
      </div>
    </form>
  );
}

function NewIndividualForm({
  onCreated,
  onCancel,
  initial,
}: {
  onCreated: (c: BusinessCustomer) => void;
  onCancel: () => void;
  initial: string;
}) {
  const t = useTranslations("pos.customer");
  const tc = useTranslations("common");
  const startsWithDigit = /^[\d+]/.test(initial);
  const [name, setName] = useState(startsWithDigit ? "" : initial);
  const [phone, setPhone] = useState(startsWithDigit ? initial : "");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const phoneOk = phone.replace(/\D/g, "").length >= 9;

  const submit = async () => {
    setBusy(true);
    try {
      onCreated(
        await rpc<BusinessCustomer>("customers.create", { customer_name: name, phone, marketing_consent: consent ? 1 : 0 }, true),
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && phoneOk) void submit();
      }}
    >
      <Field>
        <FieldLabel htmlFor="i-name">{t("personName")}</FieldLabel>
        <Input id="i-name" autoFocus className="h-11" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor="i-phone">{t("phone")}</FieldLabel>
        <Input id="i-phone" type="tel" inputMode="tel" className="num h-11" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <FieldDescription>{t("phoneHint")}</FieldDescription>
      </Field>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
        {t("consent")}
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button type="submit" disabled={busy || !name.trim() || !phoneOk}>
          {busy && <Loader2 className="animate-spin" />}
          {t("createIndividual")}
        </Button>
      </div>
    </form>
  );
}
