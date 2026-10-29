"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, ScanBarcode } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDeferredValue, useRef, useState } from "react";
import { toast } from "sonner";

import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { useFormat } from "@/hooks/use-format";
import { api, rpc } from "@/lib/api-client";
import type { ProductList } from "@/lib/types";
import type { ReceivingItem } from "@/lib/purchasing/types";

/**
 * Scan a barcode (Enter) or type a name and pick: returns the product with its last purchase price TTC,
 * VAT rate and whether it needs a lot number.
 */
export function ProductPicker({ onPick, autoFocus }: { onPick: (item: ReceivingItem) => void; autoFocus?: boolean }) {
  const t = useTranslations("purchasing.common");
  const { money } = useFormat();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const deferred = useDeferredValue(query.trim());
  const searching = deferred.length >= 2 && !/^\d{6,}$/.test(deferred);

  const results = useQuery({
    queryKey: ["products", "list", { search: deferred, picker: true }],
    queryFn: () => api<ProductList>(`/api/products?search=${encodeURIComponent(deferred)}`),
    enabled: searching,
  });

  const pick = async (code: string) => {
    setBusy(true);
    try {
      onPick(await rpc<ReceivingItem>("purchasing.find_receiving_item", { code }));
      setQuery("");
      input.current?.focus();
    } catch {
      toast.error(t("unknownBarcode", { code }));
      setQuery("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <InputGroup className="h-12">
        <InputGroupAddon>{busy ? <Loader2 className="animate-spin" /> : <ScanBarcode />}</InputGroupAddon>
        <InputGroupInput
          ref={input}
          autoFocus={autoFocus}
          type="search"
          className="text-base"
          placeholder={t("scanOrSearch")}
          aria-label={t("scanOrSearch")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const code = query.trim();
            if (!code) return;
            const first = results.data?.items[0];
            void pick(searching && first ? first.item_code : code);
          }}
        />
      </InputGroup>
      {searching && (results.data?.items.length ?? 0) > 0 && (
        <ul className="bg-popover absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border p-1 shadow-md">
          {results.data!.items.slice(0, 10).map((p) => (
            <li key={p.item_code}>
              <button
                type="button"
                className="hover:bg-accent flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 text-start text-sm"
                onClick={() => void pick(p.item_code)}
              >
                <span className="truncate">{p.item_name}</span>
                <span className="text-muted-foreground num shrink-0 text-xs">
                  {[p.brand, p.price_ttc != null ? money(p.price_ttc) : null].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
