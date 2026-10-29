import "server-only";

/**
 * ERPNext client for the ParaPilot server. Every call carries the person's own ERPNext session, so
 * ERPNext's permissions apply to everything they do. The browser never talks to ERPNext directly.
 */

const ERPNEXT_URL = process.env.ERPNEXT_URL ?? "http://localhost:8080";

export class ErpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly excType?: string,
  ) {
    super(message);
    this.name = "ErpError";
  }

  get isAuth() {
    return (
      this.status === 401 ||
      this.excType === "SessionExpired" ||
      (this.status === 403 && this.excType === "PermissionError" && /login|Guest/i.test(this.message))
    );
  }
}

function stripHtml(s: string) {
  return s.replace(/<[^>]*>/g, "").trim();
}

/** Frappe returns user-facing errors as a JSON array of JSON strings in _server_messages. */
function extractMessage(body: Record<string, unknown> | null, fallback: string): string {
  const raw = body?._server_messages;
  if (typeof raw === "string") {
    try {
      const messages = (JSON.parse(raw) as string[])
        .map((m) => {
          try {
            return stripHtml((JSON.parse(m) as { message?: string }).message ?? m);
          } catch {
            return stripHtml(m);
          }
        })
        .filter(Boolean);
      if (messages.length) return messages.join("\n");
    } catch {
      // fall through
    }
  }
  if (typeof body?.message === "string") return stripHtml(body.message);
  if (typeof body?.exception === "string") return stripHtml(body.exception.split(":").slice(1).join(":"));
  return fallback;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
}

export async function erpRequest(
  path: string,
  sid: string | undefined,
  { method = "GET", query, body }: RequestOptions = {},
): Promise<{ body: Record<string, unknown>; response: Response }> {
  const url = new URL(path, ERPNEXT_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (sid) headers.Cookie = `sid=${sid}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ErpError("ERPNext is unreachable.", 503, "Unreachable");
  }

  const parsed = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new ErpError(
      extractMessage(parsed, response.statusText),
      response.status,
      typeof parsed?.exc_type === "string" ? parsed.exc_type : undefined,
    );
  }
  return { body: parsed ?? {}, response };
}

/** Calls a whitelisted method; reads use GET, anything that writes uses POST. */
export async function erpCall<T>(
  sid: string,
  method: string,
  args: Record<string, unknown> = {},
  httpMethod: "GET" | "POST" = "GET",
): Promise<T> {
  const { body } =
    httpMethod === "GET"
      ? await erpRequest(`/api/method/${method}`, sid, {
          query: Object.fromEntries(
            Object.entries(args).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : (v as string)]),
          ),
        })
      : await erpRequest(`/api/method/${method}`, sid, { method: "POST", body: args });
  return body.message as T;
}

/** Calls a whitelisted method that returns a file (Excel export) and returns ERPNext's raw response. */
export async function erpDownload(sid: string, method: string, args: Record<string, string>): Promise<Response> {
  const url = new URL(`/api/method/${method}`, ERPNEXT_URL);
  for (const [key, value] of Object.entries(args)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Cookie: `sid=${sid}` }, cache: "no-store" }).catch(() => {
    throw new ErpError("ERPNext is unreachable.", 503, "Unreachable");
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    throw new ErpError(extractMessage(body, response.statusText), response.status);
  }
  return response;
}
