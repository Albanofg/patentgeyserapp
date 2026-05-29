import type { Response } from "express";
import { randomBytes } from "crypto";

/**
 * Log the underlying error verbosely server-side and return a sanitized
 * response to the client. Use inside route catch blocks instead of returning
 * `error.message` directly — `error.message` leaks internal exception text
 * (zod error JSON, DB constraint messages, AI provider details, file paths,
 * stack traces) to whoever called the API.
 *
 * The response carries an `errorId` correlation token (short hex) that's also
 * stamped onto the server log line, so a user can include it in a bug report
 * and the operator can grep logs for that exact failure.
 */
export function sendServerError(
  res: Response,
  error: unknown,
  clientMessage: string,
  status: number = 500,
): void {
  const errorId = randomBytes(4).toString("hex");
  const route = `${res.req.method} ${res.req.originalUrl || res.req.url}`;
  const cause = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(
    `[ERROR ${errorId}] ${route} :: ${clientMessage}\n  cause: ${cause}` +
      (stack ? `\n  stack: ${stack}` : ""),
  );
  if (!res.headersSent) {
    res.status(status).json({ message: clientMessage, errorId });
  }
}
