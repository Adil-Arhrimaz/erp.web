/** Browser-side calls to the ParaPilot server (never to ERPNext directly). */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly type?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(
  url: string,
  init?: RequestInit & { json?: unknown; redirectOn401?: boolean },
): Promise<T> {
  const { json, redirectOn401 = true, ...rest } = init ?? {};
  const response = await fetch(url, {
    ...rest,
    headers: { Accept: "application/json", ...(json !== undefined && { "Content-Type": "application/json" }) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (redirectOn401 && response.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth/")) {
      // Session gone: a full reload drops every cached query of the previous session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
    throw new ApiError(body?.error?.message ?? response.statusText, response.status, body?.error?.type);
  }
  return body as T;
}

/** Calls an allowlisted parapilot method through the ParaPilot server (see app/api/call). */
export function rpc<T>(method: string, args: Record<string, unknown> = {}, post = false): Promise<T> {
  if (post) return api<T>(`/api/call/${method}`, { method: "POST", json: args });
  const query = new URLSearchParams(
    Object.entries(args)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]),
  );
  return api<T>(`/api/call/${method}${query.size ? `?${query}` : ""}`);
}
