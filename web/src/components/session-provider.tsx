"use client";

import { useTheme } from "next-themes";
import { createContext, use, useEffect, useRef } from "react";

import type { SessionContext } from "@/lib/types";

const Session = createContext<SessionContext | null>(null);

export function SessionProvider({ value, children }: { value: SessionContext; children: React.ReactNode }) {
  const { setTheme } = useTheme();
  const appliedFor = useRef<string | null>(null);

  // The theme follows the logged-in person, not the device: apply their saved choice once per login.
  useEffect(() => {
    if (appliedFor.current === value.user) return;
    appliedFor.current = value.user;
    setTheme(value.theme);
  }, [value.user, value.theme, setTheme]);

  return <Session value={value}>{children}</Session>;
}

export function useSession(): SessionContext {
  const session = use(Session);
  if (!session) throw new Error("useSession must be used inside SessionProvider");
  return session;
}
