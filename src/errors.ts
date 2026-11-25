export type IntakeErrorCode = "invalid_id" | "invalid_query" | "not_found" | "upstream" | "timeout";

/** Thrown by `intake` and `search`. `code` is stable and safe to branch on. */
export class IntakeError extends Error {
  readonly code: IntakeErrorCode;
  constructor(code: IntakeErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "IntakeError";
    this.code = code;
  }
}
