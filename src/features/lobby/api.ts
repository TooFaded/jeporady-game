export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function api<T>(
  url: string,
  data: object = {},
  signal?: AbortSignal,
): Promise<T> {
  // AbortSignal.timeout/any are not available in every mobile browser we support.
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 12000);
  try {
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      cache: "no-store",
      signal: controller.signal,
    });
    const result = await response.json().catch(() => {
      throw new ApiError(
        "The arena is temporarily unavailable. Please try again.",
        response.status,
      );
    });
    if (!response.ok)
      throw new ApiError(
        result.error || "Could not connect. Please try again.",
        response.status,
        result.code,
      );
    return result as T;
  } catch (error) {
    if (signal?.aborted)
      throw new DOMException("Request cancelled", "AbortError");
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      "Connection interrupted. Check your connection and try again.",
      0,
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
