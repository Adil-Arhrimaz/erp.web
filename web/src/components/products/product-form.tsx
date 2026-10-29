"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, ScanBarcode, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Combobox } from "@/components/combobox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFormat } from "@/hooks/use-format";
import { api } from "@/lib/api-client";
import { isAcceptableBarcode } from "@/lib/legal-ids";
import { margin, splitTtc, toCents, ttcFromHt } from "@/lib/money";
import type { ProductDetail, ProductFormOptions, ProductInput, SaveProductResult } from "@/lib/types";

import { VatBadge } from "./vat-badge";

const decimal = /^\d+([.,]\d{0,2})?$/;
const parseDecimal = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

const formSchema = z.object({
  item_name: z.string().trim().min(1),
  item_group: z.string().min(1),
  brand: z.string().nullable(),
  pp_lab: z.string().nullable(),
  barcodes: z.array(z.string()),
  price_ttc: z.string().refine((v) => v.trim() === "" || decimal.test(v.trim())),
  has_batch_no: z.boolean(),
  pp_min_stock: z.string().refine((v) => v.trim() === "" || /^\d+$/.test(v.trim())),
  pp_is_tester: z.boolean(),
  default_supplier: z.string().nullable(),
  disabled: z.boolean(),
});
type FormValues = z.infer<typeof formSchema>;

// Batch and expiry tracking is on for every family except accessories (spec 5.2).
const NO_BATCH_GROUPS = ["Accessoires"];

function toFormValues(p: ProductDetail | null, locale: string): FormValues {
  const decimalText = (n: number) => (locale === "fr" ? n.toFixed(2).replace(".", ",") : n.toFixed(2));
  return {
    item_name: p?.item_name ?? "",
    item_group: p?.item_group ?? "",
    brand: p?.brand ?? null,
    pp_lab: p?.pp_lab ?? null,
    barcodes: p?.barcodes ?? [],
    price_ttc: p?.price_ttc != null ? decimalText(p.price_ttc) : "",
    has_batch_no: p ? p.has_batch_no === 1 : true,
    pp_min_stock: p?.pp_min_stock ? String(p.pp_min_stock) : "",
    pp_is_tester: p?.pp_is_tester === 1,
    default_supplier: p?.default_supplier ?? null,
    disabled: p?.disabled === 1,
  };
}

interface ProductFormProps {
  product: ProductDetail | null;
  options: ProductFormOptions;
  canEdit: boolean;
}

export function ProductForm({ product, options, canEdit }: ProductFormProps) {
  const t = useTranslations("products.form");
  const tp = useTranslations("products");
  const tc = useTranslations("common");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { money, moneyCents, percent, qty, locale } = useFormat();
  const formRef = useRef<HTMLFormElement>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toFormValues(product, locale),
  });
  const { control, register, handleSubmit, setValue, formState } = form;
  const [group, priceText] = useWatch({ control, name: ["item_group", "price_ttc"] });

  const groupOption = options.item_groups.find((g) => g.name === group);
  const vatRate = groupOption?.vat_rate ?? null;
  const price = decimal.test(priceText.trim()) ? parseDecimal(priceText) : null;
  const split = price !== null && vatRate !== null ? splitTtc(toCents(price), vatRate) : null;
  const costHt = product?.last_purchase_rate ? toCents(product.last_purchase_rate) : null;
  const m = split && costHt && vatRate !== null ? margin(split.ttc, costHt, vatRate) : null;

  // Ctrl+S saves, as everywhere in the back office.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "s" && (e.ctrlKey || e.metaKey) && canEdit) {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit]);

  const onSubmit = async (values: FormValues) => {
    const body: ProductInput = {
      item_code: product?.item_code,
      item_name: values.item_name,
      item_group: values.item_group,
      brand: values.brand,
      pp_lab: values.pp_lab,
      barcodes: values.barcodes,
      has_batch_no: values.has_batch_no,
      pp_min_stock: parseDecimal(values.pp_min_stock),
      pp_is_tester: values.pp_is_tester,
      default_supplier: values.default_supplier,
      disabled: values.disabled,
      ...(options.can_edit_price && { price_ttc: parseDecimal(values.price_ttc) }),
    };
    try {
      const result = await api<SaveProductResult>("/api/products", { method: "POST", json: body });
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success(product ? t("saved") : t("created"));
      for (const w of result.warnings) {
        if (w.code === "below_cost") toast.warning(t("belowCost", { loss: money(w.loss_per_unit_ht) }));
      }
      if (product) {
        form.reset(values);
        router.refresh();
      } else {
        router.replace(`/products/${encodeURIComponent(result.item_code)}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit(onSubmit)} className="mx-auto grid max-w-5xl gap-4" noValidate>
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label={tc("back")}>
          <Link href="/products">
            <ArrowLeft className="rtl:rotate-180" />
          </Link>
        </Button>
        <div className="grid min-w-0">
          <h2 className="truncate text-xl font-semibold">{product ? product.item_name : t("newTitle")}</h2>
          {product && <span className="text-muted-foreground num text-xs">{product.item_code}</span>}
        </div>
        {product?.disabled === 1 && <Badge variant="outline">{tp("disabledBadge")}</Badge>}
      </div>

      {!canEdit && (
        <Alert>
          <AlertDescription>{t("readOnly")}</AlertDescription>
        </Alert>
      )}

      <fieldset disabled={!canEdit || formState.isSubmitting} className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("identity")}</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field data-invalid={!!formState.errors.item_name}>
                  <FieldLabel htmlFor="item_name">{t("name")}</FieldLabel>
                  <Input
                    id="item_name"
                    className="h-10"
                    placeholder={t("namePlaceholder")}
                    aria-invalid={!!formState.errors.item_name}
                    {...register("item_name")}
                  />
                  {formState.errors.item_name && <FieldError>{t("required")}</FieldError>}
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="brand">{t("brand")}</FieldLabel>
                    <Controller
                      control={control}
                      name="brand"
                      render={({ field }) => (
                        <Combobox
                          id="brand"
                          value={field.value}
                          onChange={field.onChange}
                          options={options.brands.map((b) => ({ value: b, label: b }))}
                          placeholder={t("brand")}
                          creatable
                          disabled={!canEdit}
                        />
                      )}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="pp_lab">{t("lab")}</FieldLabel>
                    <Controller
                      control={control}
                      name="pp_lab"
                      render={({ field }) => (
                        <Combobox
                          id="pp_lab"
                          value={field.value}
                          onChange={field.onChange}
                          options={options.labs.map((l) => ({ value: l, label: l }))}
                          placeholder={t("lab")}
                          creatable
                          disabled={!canEdit}
                        />
                      )}
                    />
                  </Field>
                </div>
                <Field data-invalid={!!formState.errors.item_group}>
                  <FieldLabel htmlFor="item_group">{t("group")}</FieldLabel>
                  <Controller
                    control={control}
                    name="item_group"
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={(v) => {
                          field.onChange(v);
                          if (!product) setValue("has_batch_no", !NO_BATCH_GROUPS.includes(v));
                        }}
                        disabled={!canEdit}
                      >
                        <SelectTrigger
                          id="item_group"
                          className="h-10 w-full"
                          aria-invalid={!!formState.errors.item_group}
                        >
                          <SelectValue placeholder={t("group")} />
                        </SelectTrigger>
                        <SelectContent>
                          {options.item_groups.map((g) => (
                            <SelectItem key={g.name} value={g.name}>
                              <span className="flex w-full items-center justify-between gap-3">
                                {g.name}
                                <span className="text-muted-foreground text-xs">
                                  {g.vat_rate === null
                                    ? tp("noVat")
                                    : g.vat_rate === 0
                                      ? tc("vatExempt")
                                      : tc("vatRate", { rate: g.vat_rate })}
                                </span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldDescription>{t("groupHint")}</FieldDescription>
                  {formState.errors.item_group && <FieldError>{t("required")}</FieldError>}
                  {groupOption && groupOption.vat_rate === null && (
                    <Alert variant="destructive">
                      <TriangleAlert />
                      <AlertDescription>{t("noVatCategory")}</AlertDescription>
                    </Alert>
                  )}
                </Field>
                <Controller
                  control={control}
                  name="barcodes"
                  render={({ field }) => (
                    <BarcodesField value={field.value} onChange={field.onChange} disabled={!canEdit} />
                  )}
                />
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                {t("pricing")}
                {group && <VatBadge rate={vatRate} />}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field data-invalid={!!formState.errors.price_ttc}>
                  <FieldLabel htmlFor="price_ttc">{t("priceTtc")}</FieldLabel>
                  <InputGroup className="h-11 sm:max-w-60">
                    <InputGroupInput
                      id="price_ttc"
                      inputMode="decimal"
                      className="num text-lg font-semibold"
                      disabled={!canEdit || !options.can_edit_price}
                      aria-invalid={!!formState.errors.price_ttc}
                      {...register("price_ttc")}
                    />
                    <InputGroupAddon align="inline-end">DH {tc("inclVat")}</InputGroupAddon>
                  </InputGroup>
                  <FieldDescription className="num">
                    {split
                      ? t("breakdown", { ht: moneyCents(split.ht), vat: moneyCents(split.vat) })
                      : product && product.price_ttc === null
                        ? t("priceRequired")
                        : t("priceHint")}
                  </FieldDescription>
                </Field>

                {options.can_see_costs && product && (
                  <dl className="bg-muted/50 grid gap-2 rounded-lg p-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
                    <dt className="text-muted-foreground">{t("lastCost")}</dt>
                    <dd className="num">
                      {costHt
                        ? t("lastCostValue", {
                            ht: moneyCents(costHt),
                            ttc: moneyCents(ttcFromHt(costHt, vatRate ?? 0)),
                          })
                        : t("noCost")}
                    </dd>
                    {m && (
                      <>
                        <dt className="text-muted-foreground">{t("margin")}</dt>
                        <dd className={m.margin < 0 ? "text-destructive num font-medium" : "num"}>
                          {t("marginValue", {
                            amount: moneyCents(m.margin),
                            rate: percent(m.marginRate),
                            markup: percent(m.markupRate),
                          })}
                        </dd>
                      </>
                    )}
                  </dl>
                )}
                {m && m.margin < 0 && (
                  <Alert variant="destructive">
                    <TriangleAlert />
                    <AlertDescription>{t("belowCost", { loss: moneyCents(-m.margin) })}</AlertDescription>
                  </Alert>
                )}
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("stock")}</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <SwitchField name="has_batch_no" label={t("batch")} hint={t("batchHint")} control={control} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field data-invalid={!!formState.errors.pp_min_stock}>
                    <FieldLabel htmlFor="pp_min_stock">{t("minStock")}</FieldLabel>
                    <Input
                      id="pp_min_stock"
                      inputMode="numeric"
                      className="num h-10"
                      aria-invalid={!!formState.errors.pp_min_stock}
                      {...register("pp_min_stock")}
                    />
                    <FieldDescription>{t("minStockHint")}</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="default_supplier">{t("defaultSupplier")}</FieldLabel>
                    <Controller
                      control={control}
                      name="default_supplier"
                      render={({ field }) => (
                        <Combobox
                          id="default_supplier"
                          value={field.value}
                          onChange={field.onChange}
                          options={options.suppliers.map((s) => ({ value: s.name, label: s.supplier_name }))}
                          placeholder={t("defaultSupplier")}
                          disabled={!canEdit}
                        />
                      )}
                    />
                  </Field>
                </div>
                <SwitchField name="pp_is_tester" label={t("tester")} control={control} />
                {product && <SwitchField name="disabled" label={t("disabled")} control={control} />}
              </FieldGroup>
            </CardContent>
          </Card>
        </div>

        <aside className="grid content-start gap-4">
          {product && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("stockNow")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <p className="num text-2xl font-semibold">{tc("units", { count: product.stock_qty })}</p>
                <ul className="grid gap-1">
                  {product.stock_by_warehouse.map((w) => (
                    <li key={w.warehouse} className="flex justify-between gap-2">
                      <span className="text-muted-foreground truncate">{w.warehouse}</span>
                      <span className="num">{qty(w.actual_qty)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </aside>
      </fieldset>

      {canEdit && (
        <div className="bg-background/95 sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex justify-end gap-2 border-t px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-xl md:border">
          <Button asChild variant="outline" size="lg">
            <Link href="/products">{tc("cancel")}</Link>
          </Button>
          <Button type="submit" size="lg" disabled={formState.isSubmitting || (product !== null && !formState.isDirty)}>
            {formState.isSubmitting && <Loader2 className="animate-spin" />}
            {formState.isSubmitting ? tc("saving") : tc("save")}
          </Button>
        </div>
      )}
    </form>
  );
}

function SwitchField({
  name,
  label,
  hint,
  control,
}: {
  name: "has_batch_no" | "pp_is_tester" | "disabled";
  label: string;
  hint?: string;
  control: ReturnType<typeof useForm<FormValues>>["control"];
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={name}>{label}</FieldLabel>
            {hint && <FieldDescription>{hint}</FieldDescription>}
          </FieldContent>
          <Switch id={name} checked={field.value} onCheckedChange={field.onChange} />
        </Field>
      )}
    />
  );
}

function BarcodesField({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  disabled: boolean;
}) {
  const t = useTranslations("products.form");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const code = draft.trim();
    if (!code) return;
    if (value.includes(code)) return setError(t("duplicateBarcode", { code }));
    if (!isAcceptableBarcode(code)) return setError(t("invalidEan", { code }));
    onChange([...value, code]);
    setDraft("");
    setError(null);
  };

  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor="barcode-input">{t("barcodes")}</FieldLabel>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((code) => (
            <li key={code}>
              <Badge variant="secondary" className="num h-8 gap-1 ps-3 text-sm">
                {code}
                {!disabled && (
                  <button
                    type="button"
                    className="hover:bg-background/60 rounded-full p-1"
                    aria-label={t("removeBarcode", { code })}
                    onClick={() => onChange(value.filter((c) => c !== code))}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <InputGroup className="h-10 sm:max-w-80">
          <InputGroupAddon>
            <ScanBarcode />
          </InputGroupAddon>
          <InputGroupInput
            id="barcode-input"
            inputMode="numeric"
            className="num"
            value={draft}
            placeholder={t("barcodePlaceholder")}
            aria-invalid={!!error}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              // A scanner ends with Enter: add the code instead of submitting the form.
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton onClick={add} disabled={!draft.trim()}>
              {t("addBarcode")}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      )}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}
