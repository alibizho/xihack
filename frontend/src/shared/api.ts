import { fill, t } from "./i18n.ts";

type ApiError = { code?: string; message?: string };
const errors: Record<string, () => string> = {
  AUTH_REQUIRED: () => t("errAuthRequired"),
  AUTH_INVALID: () => t("errAuthInvalid"),
  REGISTRATION_UNAVAILABLE: () => t("errRegistration"),
  CSRF_INVALID: () => t("errCsrf"),
  ORIGIN_INVALID: () => t("errOrigin"),
  RATE_LIMITED: () => t("errRateLimited"),
  RUN_LIMIT_REACHED: () => t("errRunLimit"),
  INVALID_REQUEST: () => t("errInvalidRequest"),
  PROPOSAL_EXPIRED: () => t("batchExpired"),
  PROPOSAL_BATCH_EMPTY: () => t("batchEmpty"),
  PROPOSAL_BATCH_CONFIRM_REQUIRED: () => t("batchConfirmRequired"),
  PROPOSAL_UNAVAILABLE: () => t("batchUnavailable"),
  IDEMPOTENCY_CONFLICT: () => t("batchIdempotencyConflict"),
};

export class ApiRequestError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, credentials: "include" }).catch(() => {
    throw new ApiRequestError("NETWORK_ERROR", t("errNetwork"));
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as ApiError;
    throw new ApiRequestError(error.code || "HTTP_ERROR", errors[error.code || ""]?.() || (response.status >= 500 ? t("errServerDown") : fill("requestFailed", { status: response.status })));
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export function post<T>(path: string, body: object, csrf?: string): Promise<T> {
  return api<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
    body: JSON.stringify(body),
  });
}
