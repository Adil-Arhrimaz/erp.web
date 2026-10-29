"use client";

import { useTranslations } from "next-intl";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import {
  CompanySection,
  FamiliesSection,
  ImportSection,
  PosSection,
  TillsSection,
  UsersSection,
  VatSection,
  useSettings,
} from "./sections";

export function SettingsView() {
  const t = useTranslations("settings.sections");
  const settings = useSettings();
  if (!settings.data) return <Skeleton className="mx-auto h-96 max-w-4xl" />;
  const data = settings.data;

  const section = (key: string, body: React.ReactNode) => (
    <Card key={key}>
      <CardHeader>
        <CardTitle className="text-base">{t(key)}</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      {section("company", <CompanySection data={data} />)}
      {section("vat", <VatSection data={data} />)}
      {section("families", <FamiliesSection data={data} />)}
      {data.is_owner && section("pos", <PosSection data={data} />)}
      {data.is_owner && section("tills", <TillsSection data={data} />)}
      {data.is_owner && section("users", <UsersSection />)}
      {data.is_owner && section("import", <ImportSection />)}
    </div>
  );
}
