export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Strip anything that looks like a credential before it reaches a log line. */
export function redact(text: string): string {
  return text
    .replace(/sk-ant-[A-Za-z0-9_\-]{8,}/g, 'sk-ant-[redacted]')
    .replace(/(api[_-]?key|password|pass|token|secret)(["'\s:=]+)([^\s"',]{4,})/gi, '$1$2[redacted]');
}
