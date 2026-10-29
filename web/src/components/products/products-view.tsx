"use client";

import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Package, Plus, ScanBarcode } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useDeferredValue, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFormat } from "@/hooks/use-format";
import { api } from "@/lib/api-client";
import type { Product, ProductFormOptions, ProductList } from "@/lib/types";

import { VatBadge } from "./vat-badge";

const ALL = "__all__";

function StockBadge({ product }: { product: Product }) {
  const t = useTranslations("products");
  const { qty } = useFormat();
  if (!product.is_stock_item) return null;
  if (product.stock_qty <= 0) return <Badge variant="destructive">{t("outOfStock")}</Badge>;
  const low = product.pp_min_stock > 0 && product.stock_qty < product.pp_min_stock;
  return (
    <span className="num inline-flex items-center gap-2">
      {qty(product.stock_qty)}
      {low && (
        <Badge className="bg-warning text-warning-foreground" variant="default">
          {t("lowStock")}
        </Badge>
      )}
    </span>
  );
}

export function ProductsView({ canCreate }: { canCreate: boolean }) {
  const t = useTranslations("products");
  const tc = useTranslations("common");
  const router = useRouter();
  const { money } = useFormat();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState(ALL);
  const [brand, setBrand] = useState(ALL);
  const [status, setStatus] = useState("active");
  const deferredSearch = useDeferredValue(search.trim());

  const options = useQuery({
    queryKey: ["products", "options"],
    queryFn: () => api<ProductFormOptions>("/api/products/options"),
  });

  const filters = { search: deferredSearch, group, brand, status };
  const list = useInfiniteQuery({
    queryKey: ["products", "list", filters],
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ status, start: String(pageParam) });
      if (filters.search) params.set("search", filters.search);
      if (group !== ALL) params.set("item_group", group);
      if (brand !== ALL) params.set("brand", brand);
      return api<ProductList>(`/api/products?${params}`);
    },
    getNextPageParam: (last) => (last.has_more ? last.start + last.items.length : undefined),
  });

  const products = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);

  const columns = useMemo<ColumnDef<Product>[]>(
    () => [
      {
        id: "product",
        header: t("columns.product"),
        cell: ({ row: { original: p } }) => (
          <div className="grid min-w-0">
            <span className="flex min-w-0 items-center gap-2 font-medium">
              <span className="truncate">{p.item_name}</span>
              {p.disabled === 1 && <Badge variant="outline">{t("disabledBadge")}</Badge>}
            </span>
            <span className="text-muted-foreground num truncate text-xs">
              {[p.brand, p.barcodes[0], p.item_code].filter(Boolean).join(" · ")}
            </span>
          </div>
        ),
      },
      {
        id: "group",
        header: t("columns.group"),
        cell: ({ row: { original: p } }) => (
          <span className="flex flex-col items-start gap-1 xl:flex-row xl:items-center xl:gap-2">
            {p.item_group}
            <VatBadge rate={p.vat_rate} />
          </span>
        ),
      },
      {
        id: "price",
        header: () => <span className="block text-end">{t("columns.price")}</span>,
        cell: ({ row: { original: p } }) => (
          <span className="num block text-end">
            {p.price_ttc === null ? <Badge variant="outline">{t("noPrice")}</Badge> : money(p.price_ttc)}
          </span>
        ),
      },
      {
        id: "stock",
        header: () => <span className="block text-end">{t("columns.stock")}</span>,
        cell: ({ row: { original: p } }) => (
          <span className="block text-end">
            <StockBadge product={p} />
          </span>
        ),
      },
    ],
    [t, money],
  );

  const table = useReactTable({ data: products, columns, getCoreRowModel: getCoreRowModel() });

  // A scanner types the code and presses Enter: open the product when the code matches exactly.
  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const code = search.trim();
    const match = products.find((p) => p.barcodes.includes(code) || p.item_code === code);
    if (match) router.push(`/products/${encodeURIComponent(match.item_code)}`);
  };

  const filtering = deferredSearch || group !== ALL || brand !== ALL || status !== "active";

  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <InputGroup className="h-11 lg:max-w-sm lg:flex-1">
          <InputGroupAddon>
            <ScanBarcode />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={t("searchPlaceholder")}
            aria-label={tc("search")}
            autoFocus
          />
        </InputGroup>
        <div className="grid grid-cols-2 gap-2 lg:flex">
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger className="h-11 w-full lg:w-44" aria-label={t("filters.group")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.allOf", { label: t("filters.group") })}</SelectItem>
              {options.data?.item_groups.map((g) => (
                <SelectItem key={g.name} value={g.name}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={brand} onValueChange={setBrand}>
            <SelectTrigger className="h-11 w-full lg:w-40" aria-label={t("filters.brand")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.allOf", { label: t("filters.brand") })}</SelectItem>
              {options.data?.brands.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          value={status}
          onValueChange={(v) => v && setStatus(v)}
          aria-label={t("filters.status")}
        >
          <ToggleGroupItem value="active" className="h-11 px-3">
            {t("filters.active")}
          </ToggleGroupItem>
          <ToggleGroupItem value="disabled" className="h-11 px-3">
            {t("filters.disabled")}
          </ToggleGroupItem>
        </ToggleGroup>
        {canCreate && (
          <Button asChild size="lg" className="h-11 lg:ms-auto">
            <Link href="/products/new">
              <Plus /> {t("new")}
            </Link>
          </Button>
        )}
      </div>

      {list.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{tc("errorTitle")}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {list.error.message}
            <Button size="sm" variant="outline" onClick={() => list.refetch()}>
              {tc("retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : list.isPending ? (
        <div className="grid gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Package />
            </EmptyMedia>
            <EmptyDescription>{filtering ? t("empty") : t("emptyCatalog")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {/* Phone: one card per product. */}
          <ul className="grid gap-2 md:hidden">
            {products.map((p) => (
              <li key={p.item_code}>
                <Link
                  href={`/products/${encodeURIComponent(p.item_code)}`}
                  className="bg-card hover:bg-accent flex items-center gap-3 rounded-xl border p-3"
                >
                  <div className="grid min-w-0 flex-1 gap-1">
                    <span className="truncate font-medium">{p.item_name}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {[p.brand, p.item_group].filter(Boolean).join(" · ")}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-xs">
                      <VatBadge rate={p.vat_rate} />
                      <StockBadge product={p} />
                    </span>
                  </div>
                  <span className="num shrink-0 font-semibold">
                    {p.price_ttc === null ? <Badge variant="outline">{t("noPrice")}</Badge> : money(p.price_ttc)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {/* Tablet and desktop: data table. */}
          <div className="bg-card hidden overflow-hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => (
                      <TableHead key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/products/${encodeURIComponent(row.original.item_code)}`)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        // The product column takes the remaining width and truncates; the others fit.
                        className={cell.column.id === "product" ? "w-full max-w-0 py-3" : "py-3 whitespace-nowrap"}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {list.hasNextPage && (
            <Button
              variant="outline"
              className="justify-self-center"
              onClick={() => list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
            >
              {list.isFetchingNextPage ? tc("loading") : tc("loadMore")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
