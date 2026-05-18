import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response, url?: string) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let body: any = undefined;
    try {
      body = JSON.parse(text);
    } catch {
      // non-JSON response
    }
    // Prefer a server-supplied message. Fall back to a generic status line so
    // we never dump an entire serialized response body into toasts/UI when the
    // server forgets to include a `message` field.
    const friendlyFromBody =
      typeof body?.message === "string"
        ? body.message
        : typeof body?.error === "string"
          ? body.error
          : null;
    const looksLikeJsonBlob = text.length > 240 || text.trimStart().startsWith("{") || text.trimStart().startsWith("[");
    const fallback = `Request failed (${res.status} ${res.statusText || ""})`.trim();
    const message = friendlyFromBody ?? (looksLikeJsonBlob ? fallback : text);
    const err: any = new Error(message);
    err.status = res.status;
    err.body = body;
    throw err;
  }
}

export async function apiRequest<T = any>(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return await res.json();
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
