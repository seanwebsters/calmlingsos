/** Errors with a meaning the UI and workflow engine understand. */

export class AppError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "bad_request",
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new AppError(what, 404, "not_found");
export const forbidden = (what = "You don't have permission to do that.") => new AppError(what, 403, "forbidden");
export const unauthorized = () => new AppError("Sign in to continue.", 401, "unauthorized");
export const conflict = (what: string, details?: unknown) => new AppError(what, 409, "conflict", details);

/**
 * A required integration is missing or unusable. Steps that hit this become
 * BLOCKED with a setup action – never silently replaced by placeholder output.
 */
export class IntegrationRequiredError extends AppError {
  constructor(
    readonly requirement: string,
    message: string,
    readonly setupHref = "/settings",
  ) {
    super(message, 424, "integration_required", { requirement, setupHref });
  }
}

/** A provider call failed. `retryable` decides whether the workflow engine retries. */
export class ProviderError extends AppError {
  constructor(
    readonly provider: string,
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
    readonly httpStatus: number | null = null,
  ) {
    super(message, 502, "provider_error", { provider, retryable });
  }
}

/** Spending would exceed a configured limit – needs a human to raise it. */
export class BudgetExceededError extends AppError {
  constructor(message: string, readonly neededCents: number, readonly remainingCents: number) {
    super(message, 402, "budget_exceeded", { neededCents, remainingCents });
  }
}

/** A Character Lock / canon guard refused a change. */
export class CanonGuardError extends AppError {
  constructor(message: string, readonly fields: string[]) {
    super(message, 409, "canon_locked", { fields });
  }
}
