import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import type { Locale } from "@/lib/types";

export const locales: Locale[] = ["fr", "en"];
export const defaultLocale: Locale = "fr";

/** One message file per area of the app, merged under the area's name. */
const AREAS = ["common", "auth", "nav", "home", "products", "pos", "till", "purchasing", "stock", "returns", "customers", "vat", "reports", "settings", "setup"] as const;

export default getRequestConfig(async () => {
  const cookie = (await cookies()).get("NEXT_LOCALE")?.value as Locale | undefined;
  const locale = cookie && locales.includes(cookie) ? cookie : defaultLocale;

  const entries = await Promise.all(
    AREAS.map(async (area) => [area, (await import(`../../messages/${locale}/${area}.json`)).default]),
  );

  return {
    locale,
    messages: Object.fromEntries(entries),
    timeZone: "Africa/Casablanca",
  };
});
