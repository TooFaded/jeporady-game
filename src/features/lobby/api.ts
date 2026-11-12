export async function api<T>(url: string, data: object = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new Error(
      "Connection interrupted. Check your connection and try again.",
    );
  }
  const result = await response.json().catch(() => {
    throw new Error("The arena is temporarily unavailable. Please try again.");
  });
  if (!response.ok)
    throw new Error(result.error || "Could not connect. Please try again.");
  return result as T;
}
