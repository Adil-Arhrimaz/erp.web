import { redirect } from "next/navigation";

import { getSessionContext } from "@/server/session";

import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const target = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (await getSessionContext()) redirect(target);
  return <LoginForm next={target} />;
}
