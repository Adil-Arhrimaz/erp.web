"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Combobox } from "@/components/combobox";
import { rpc } from "@/lib/api-client";
import type { Supplier } from "@/lib/purchasing/types";

export function useSuppliers() {
  return useQuery({
    queryKey: ["purchasing", "suppliers"],
    queryFn: () => rpc<Supplier[]>("purchasing.list_suppliers"),
  });
}

export function SupplierSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  value: string | null;
  onChange: (supplier: Supplier | null) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("purchasing.common");
  const suppliers = useSuppliers();
  return (
    <Combobox
      id={id}
      value={value}
      disabled={disabled}
      placeholder={t("chooseSupplier")}
      onChange={(name) => onChange(suppliers.data?.find((s) => s.name === name) ?? null)}
      options={(suppliers.data ?? []).map((s) => ({ value: s.name, label: s.supplier_name }))}
    />
  );
}
