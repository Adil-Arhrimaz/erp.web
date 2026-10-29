import { CalendarClock, PackageMinus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hasRole, navigationFor } from "@/lib/navigation";
import type { ExpiryBoard, StockRow } from "@/lib/stock/types";
import { erpCall } from "@/server/erpnext";
import { requireSession } from "@/server/session";

export default async function HomePage() {
  const { sid, context } = await requireSession();
  const t = await getTranslations("home");
  const watchesStock = hasRole(context.roles, "owner", "manager", "stock_clerk");
  const [expiry, low] = watchesStock
    ? await Promise.all([
        erpCall<ExpiryBoard>(sid, "parapilot.api.stock.expiry_board", { days: 30 }),
        erpCall<{ items: StockRow[] }>(sid, "parapilot.api.stock.stock_overview", { low_only: 1 }),
      ])
    : [null, null];
  const alerts = [
    { key: "expired", count: expiry?.totals.expired?.batches ?? 0, href: "/stock?tab=expiry", icon: TriangleAlert, tone: "destructive" },
    { key: "expiring", count: expiry?.totals["30"]?.batches ?? 0, href: "/stock?tab=expiry", icon: CalendarClock, tone: "warning" },
    { key: "lowStock", count: low?.items.length ?? 0, href: "/stock?tab=low", icon: PackageMinus, tone: "warning" },
  ] as const;
  const tc = await getTranslations("common");
  const tset = await getTranslations("setup");
  const tn = await getTranslations("nav");
  const actions = navigationFor(context.roles)
    .flatMap((g) => g.items)
    .filter((i) => i.href !== "/");
  const company = context.company;
  const legalIds = (["ice", "if", "rc", "tp"] as const).map((key) => ({ key, value: company?.[key] }));

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          {t("greeting", { name: context.full_name.split(" ")[0] })}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t("subtitle", { company: company?.name ?? "", role: tc(`roles.${context.roles[0]}`) })}
        </p>
      </div>

      {!context.setup_complete && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>{t("setupNeeded")}</AlertTitle>
          <AlertDescription className="grid gap-2">
            {t("setupNeededBody")}
            {hasRole(context.roles, "owner") && (
              <Link href="/setup" className="text-primary font-medium underline">
                {tset("title")}
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}

      {watchesStock && (
        <section aria-labelledby="alerts" className="grid gap-3">
          <h3 id="alerts" className="text-muted-foreground text-sm font-medium">
            {t("alerts")}
          </h3>
          {alerts.every((a) => a.count === 0) ? (
            <p className="text-muted-foreground text-sm">{t("allGood")}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              {alerts
                .filter((a) => a.count > 0)
                .map((a) => (
                  <Link
                    key={a.key}
                    href={a.href}
                    className={
                      a.tone === "destructive"
                        ? "border-destructive/40 bg-destructive/5 hover:bg-destructive/10 flex items-center gap-3 rounded-xl border p-4"
                        : "border-warning/50 bg-warning/10 hover:bg-warning/20 flex items-center gap-3 rounded-xl border p-4"
                    }
                  >
                    <a.icon className={a.tone === "destructive" ? "text-destructive size-5" : "text-warning-foreground size-5"} />
                    <span className="text-sm font-medium">{t(a.key, { count: a.count })}</span>
                  </Link>
                ))}
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="quick-actions" className="grid gap-3">
        <h3 id="quick-actions" className="text-muted-foreground text-sm font-medium">
          {t("quickActions")}
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {actions.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="bg-card hover:bg-accent focus-visible:ring-ring flex min-h-20 flex-col justify-between gap-2 rounded-xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <item.icon className="text-primary size-5" />
              <span className="text-sm font-medium">{tn(item.key)}</span>
            </Link>
          ))}
        </div>
      </section>

      {company && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("legalIds")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                {legalIds.map(({ key, value }) => (
                  <div key={key} className="contents">
                    <dt className="text-muted-foreground">{t(key)}</dt>
                    <dd className="num">
                      {value ? value : <Badge variant="destructive">{t("missing")}</Badge>}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("shop")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t("vatPeriod")}</dt>
                <dd>{t(`periods.${context.settings.vat_period}`)}</dd>
              </dl>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
