"use client";

import { Leaf, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ApiError, api } from "@/lib/api-client";
import type { Locale, ThemePreference } from "@/lib/types";

interface Verification {
  method?: "OTP App" | "Email" | "SMS";
  prompt?: string;
}

type LoginResponse =
  | { ok: true; language: Locale; theme: ThemePreference }
  | { verification: Verification; tmp_id: string };

export function LoginForm({ next }: { next: string }) {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { setTheme } = useTheme();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<{ tmpId: string; verification: Verification } | null>(null);
  const [otp, setOtp] = useState("");

  const setLanguage = (value: string) => {
    if (!value) return;
    document.cookie = `NEXT_LOCALE=${value}; path=/; samesite=lax; max-age=31536000`;
    router.refresh();
  };

  const submit = (body: Record<string, string>) =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await api<LoginResponse>("/api/auth/login", { method: "POST", json: body });
        if ("verification" in result) {
          setStep({ tmpId: result.tmp_id, verification: result.verification });
          return;
        }
        setTheme(result.theme);
        // A full navigation so the whole app renders in the user's language with the new session.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(next);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) setError(step ? t("invalidOtp") : t("invalid"));
        else if (e instanceof ApiError && e.status === 503) setError(tc("unreachable"));
        else setError((e as Error).message);
      }
    });

  const otpHint =
    step?.verification.method === "Email"
      ? t("otpSubtitleEmail")
      : step?.verification.method === "SMS"
        ? t("otpSubtitleSms")
        : t("otpSubtitle");

  return (
    <div className="bg-muted/40 flex min-h-dvh flex-col items-center justify-center gap-6 p-4">
      <div className="flex items-center gap-2 text-lg font-semibold">
        <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg">
          <Leaf className="size-5" />
        </span>
        {tc("appName")}
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{step ? t("otpTitle") : t("title")}</CardTitle>
          <CardDescription>{step ? otpHint : t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {step ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit({ otp, tmp_id: step.tmpId });
              }}
            >
              <FieldGroup>
                <Field>
                  <InputOTP
                    maxLength={6}
                    value={otp}
                    onChange={setOtp}
                    autoFocus
                    inputMode="numeric"
                    containerClassName="justify-center"
                  >
                    <InputOTPGroup>
                      {Array.from({ length: 6 }, (_, i) => (
                        <InputOTPSlot key={i} index={i} className="size-11 text-lg" />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </Field>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" size="lg" disabled={pending || otp.length < 6}>
                  {pending && <Loader2 className="animate-spin" />}
                  {t("otpSubmit")}
                </Button>
              </FieldGroup>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                submit({ usr: String(data.get("usr")), pwd: String(data.get("pwd")) });
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="usr">{t("username")}</FieldLabel>
                  <Input id="usr" name="usr" autoComplete="username" required autoFocus className="h-11" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="pwd">{t("password")}</FieldLabel>
                  <Input
                    id="pwd"
                    name="pwd"
                    type="password"
                    autoComplete="current-password"
                    required
                    className="h-11"
                  />
                </Field>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" size="lg" className="h-11" disabled={pending}>
                  {pending && <Loader2 className="animate-spin" />}
                  {pending ? t("submitting") : t("submit")}
                </Button>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>

      <ToggleGroup
        type="single"
        value={locale}
        onValueChange={setLanguage}
        variant="outline"
        aria-label={tc("language.label")}
      >
        <ToggleGroupItem value="fr" className="min-h-11 px-4">
          {tc("language.fr")}
        </ToggleGroupItem>
        <ToggleGroupItem value="en" className="min-h-11 px-4">
          {tc("language.en")}
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
