import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { findNavItem } from "@/lib/navigation";
import { requireSession } from "@/server/session";

/** Screens of later milestones: reachable from the navigation, honest about their state. */
export default async function ModulePage({ params }: PageProps<"/[module]">) {
  const { module } = await params;
  const item = findNavItem(`/${module}`);
  if (!item || item.ready) notFound();

  const { context } = await requireSession();
  if (!item.roles.some((r) => context.roles.includes(r))) redirect("/");

  const t = await getTranslations("common");
  const tn = await getTranslations("nav");

  return (
    <Empty className="min-h-[60dvh]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <item.icon />
        </EmptyMedia>
        <EmptyTitle>{t("comingSoonTitle", { module: tn(item.key) })}</EmptyTitle>
        <EmptyDescription>{t("comingSoonBody")}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
