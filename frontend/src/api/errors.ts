export class ApiError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | undefined;

  constructor(status: number, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const fallbackMessages: Record<number, string> = {
  401: "Your session has expired. Sign in again to continue.",
  403: "You do not have permission to do that.",
  409: "This item changed elsewhere. Refresh and try again.",
  413: "That file is too large to upload.",
  422: "Some information needs correcting. Review the fields and try again.",
  429: "Too many requests. Wait a moment before trying again.",
  503: "This service is temporarily unavailable. Try again shortly.",
};

function extractDetail(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const detail = Object.getOwnPropertyDescriptor(payload, "detail")?.value;
  if (typeof detail === "string") return detail;
  if (!Array.isArray(detail)) return undefined;

  const messages = detail.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const message = Object.getOwnPropertyDescriptor(item, "msg")?.value;
    return typeof message === "string" ? [message] : [];
  });
  return messages.length > 0 ? messages.join(" ") : undefined;
}

export async function normalizeApiError(
  response: Response,
  parsedPayload?: unknown,
): Promise<ApiError> {
  let detail = extractDetail(parsedPayload);
  if (!detail) {
    try {
      detail = extractDetail(await response.clone().json());
    } catch {
      detail = undefined;
    }
  }

  const retryHeader = response.headers.get("Retry-After");
  const retryAfterSeconds = retryHeader ? Number.parseInt(retryHeader, 10) : undefined;
  return new ApiError(
    response.status,
    detail ?? fallbackMessages[response.status] ?? "Something went wrong. Try again.",
    Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
  );
}
