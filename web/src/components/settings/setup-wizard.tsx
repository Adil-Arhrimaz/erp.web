"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, PartyPopper } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { rpc } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import {
  CompanySection,
  FamiliesSection,
  ImportSection,
  LocationsSection,
  type SettingsData,
  TillsSection,
  UsersSection,
  VatSection,
  useSettings,
} from "./sections";

/** The eight first-launch steps (spec 5.1); each is saved as soon as it is done. */
export function SetupWizard() {
  const t = useTranslations("setup");
  const queryClient = useQueryClient();
  const settings = useSettings();
  const [step, setStep] = useState<string | null>(null);
  if (!settings.data) return <Skeleton className="mx-auto h-96 max-w-3xl" />;
  const data = settings.data;
  const steps = data.steps;
  const current = step ?? (data.company ? steps.find((s) => !data.steps_done.includes(s)) ?? null : "company");
  const allDone = steps.every((s) => data.steps_done.includes(s));

  const next = async () => {
    if (!current) return;
    queryClient.setQueryData(["settings"], await rpc<SettingsData>("settings.mark_step", { step: current }, true));
    const index = steps.indexOf(current);
    setStep(steps[index + 1] ?? null);
  };

  const body: Record<string, React.ReactNode> = {
    company: <CompanySection data={data} />,
    vat: <VatSection data={data} />,
    categories: (
      <div className="grid gap-3">
        <Alert>
          <AlertDescription>{t("categoriesHint")}</AlertDescription>
        </Alert>
        <ul className="grid gap-1 text-sm">
          {data.templates.map((tpl) => (
            <li key={tpl.name} className="flex justify-between rounded-lg border p-3">
              <span>{tpl.title}</span>
              <span className="num">{tpl.rate} %</span>
            </li>
          ))}
        </ul>
        <VatSection data={data} />
      </div>
    ),
    families: <FamiliesSection data={data} />,
    locations: (
      <div className="grid gap-3">
        <p className="text-muted-foreground text-sm">{t("locationsHint")}</p>
        <LocationsSection data={data} />
      </div>
    ),
    tills: <TillsSection data={data} />,
    users: <UsersSection />,
    products: <ImportSection onImported={() => void next()} />,
  };

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div>
        <h2 className="text-2xl font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">{t("intro")}</p>
      </div>
      <ol className="flex flex-wrap gap-2" aria-label={t("title")}>
        {steps.map((s, i) => {
          const done = data.steps_done.includes(s);
          return (
            <li key={s}>
              <button
                type="button"
                disabled={!data.company && s !== "company"}
                onClick={() => setStep(s)}
                aria-current={current === s ? "step" : undefined}
                className={cn(
                  "flex h-10 items-center gap-2 rounded-full border px-3 text-sm disabled:opacity-50",
                  current === s && "border-primary bg-accent font-semibold",
                  done && current !== s && "text-success",
                )}
              >
                {done ? <Check className="size-4" /> : <span className="num">{i + 1}</span>}
                {t(`steps.${s}`)}
              </button>
            </li>
          );
        })}
      </ol>

      {current ? (
        <Card>
          <CardHeader>
            <CardTitle>{t(`steps.${current}`)}</CardTitle>
            <CardDescription>{steps.indexOf(current) + 1} / {steps.length}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {body[current]}
            {data.company && (
              <div className="flex justify-end gap-2 border-t pt-4">
                <Button variant="ghost" onClick={() => setStep(steps[steps.indexOf(current) + 1] ?? null)}>
                  {t("skip")}
                </Button>
                <Button onClick={() => void next()}>{current === steps.at(-1) ? t("done") : t("next")}</Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <PartyPopper className="text-primary size-10" />
            <p className="text-lg font-semibold">{allDone ? t("finish") : t("done")}</p>
            <Button asChild>
              <Link href="/">{t("done")}</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
