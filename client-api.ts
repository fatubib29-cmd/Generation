export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  businessId?: string;
  params?: Record<string, string | number | undefined | null>;
  body?: Record<string, unknown>;
  signal?: AbortSignal;
};

export async function apiRequest<T>(route: string, options: RequestOptions = {}): Promise<T> {
  const params = new URLSearchParams({ route });
  if (options.businessId) params.set("businessId", options.businessId);
  for (const [key, value] of Object.entries(options.params ?? {})) {
    if (value !== undefined && value !== null && String(value) !== "") params.set(key, String(value));
  }
  const method = options.method ?? "GET";
  const response = await fetch(`/api/action?${params.toString()}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify({ ...(options.businessId ? { businessId: options.businessId } : {}), ...options.body }) : undefined,
    signal: options.signal,
  });
  let payload: Record<string, unknown>;
  try {
    payload = await response.json() as Record<string, unknown>;
  } catch {
    throw new Error("The server returned an unreadable response. Please try again.");
  }
  if (!response.ok) {
    const details = Array.isArray(payload.details)
      ? payload.details.map((item) => item && typeof item === "object" ? (item as { message?: string }).message : "").filter(Boolean).join(" ")
      : "";
    throw new Error([typeof payload.error === "string" ? payload.error : "Request failed.", details].filter(Boolean).join(" "));
  }
  return payload as T;
}
