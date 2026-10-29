"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Search, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useFormat } from "@/hooks/use-format";
import { rpc } from "@/lib/api-client";
import type { Customer, CustomerHistory } from "@/lib/stock/types";

export function CustomersView() {
  const t = useTranslations("customers");
  const { money, locale } = useFormat();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const deferred = useDeferredValue(search.trim());
  const customers = useQuery({
    queryKey: ["customers", deferred],
    queryFn: () => rpc<Customer[]>("customers.list_customers", { search_text: deferred }),
  });
  const date = (d: string) => new Date(d).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB");

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <InputGroup className="h-11 sm:max-w-sm">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput type="search" placeholder={t("search")} aria-label={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} />
      </InputGroup>
      {customers.isPending ? (
        <Skeleton className="h-40" />
      ) : !customers.data?.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{t("empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-2">
          {customers.data.map((c) => (
            <li key={c.name}>
              <button
                type="button"
                onClick={() => setOpen(c.name)}
                className="bg-card hover:bg-accent flex w-full items-center gap-3 rounded-xl border p-3 text-start"
              >
                {c.customer_type === "Company" ? (
                  <Building2 className="text-muted-foreground size-5 shrink-0" aria-label={t("company")} />
                ) : (
                  <User className="text-muted-foreground size-5 shrink-0" aria-label={t("individual")} />
                )}
                <span className="grid min-w-0 flex-1">
                  <span className="truncate font-medium">{c.customer_name}</span>
                  <span className="text-muted-foreground num truncate text-xs">
                    {[c.pp_phone, c.pp_ice && `ICE ${c.pp_ice}`, c.last_visit && t("lastVisit", { date: date(c.last_visit) })]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="num text-sm font-semibold">{money(c.total ?? 0)}</span>
                  <span className="text-muted-foreground text-xs">{t("visits", { count: c.visits ?? 0 })}</span>
                </span>
                {c.pp_marketing_consent === 1 && <Badge variant="secondary">{t("consent")}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">{open && <CustomerSheet name={open} />}</SheetContent>
      </Sheet>
    </div>
  );
}

function CustomerSheet({ name }: { name: string }) {
  const t = useTranslations("customers");
  const queryClient = useQueryClient();
  const { money, locale } = useFormat();
  const history = useQuery({ queryKey: ["customers", "history", name], queryFn: () => rpc<CustomerHistory>("customers.history", { customer: name }) });
  const date = (d: string) => new Date(d).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB");

  const setConsent = async (consent: boolean) => {
    try {
      await rpc("customers.set_consent", { customer: name, consent: consent ? 1 : 0 }, true);
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (!history.data) return <Skeleton className="m-4 h-40" />;
  const c = history.data.customer;
  return (
    <>
      <SheetHeader>
        <SheetTitle>{c.customer_name}</SheetTitle>
        <SheetDescription className="num">{[c.pp_phone, c.pp_ice && `ICE ${c.pp_ice}`].filter(Boolean).join(" · ")}</SheetDescription>
      </SheetHeader>
      <div className="grid gap-5 px-4 pb-6">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="consent">{t("consent")}</FieldLabel>
            <FieldDescription>
              {c.pp_marketing_consent_on ? t("consentOn", { date: date(c.pp_marketing_consent_on) }) : t("consentHint")}
            </FieldDescription>
          </FieldContent>
          <Switch id="consent" checked={c.pp_marketing_consent === 1} onCheckedChange={(v) => void setConsent(v)} />
        </Field>
        <section className="grid gap-2">
          <h3 className="text-sm font-medium">{t("history")}</h3>
          <ul className="grid gap-2">
            {history.data.invoices.map((inv) => (
              <li key={inv.name} className="rounded-lg border p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">
                    {date(inv.posting_date)} {inv.is_return ? <Badge variant="outline">{t("return")}</Badge> : null}
                  </span>
                  <span className="num">{money(inv.grand_total)}</span>
                </div>
                <p className="text-muted-foreground text-xs">{inv.lines.map((l) => `${Math.abs(l.qty)} × ${l.item_name}`).join(", ")}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
