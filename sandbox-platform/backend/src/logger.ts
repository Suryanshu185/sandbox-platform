import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: [
      "password",
      "passwordHash",
      "apiKey",
      "keyHash",
      "authorization",
      "secret",
      "secrets.*",
      "*.password",
      "*.secret",
      "*.apiKey",
      "req.headers.authorization",
      "env.SECRET_*",
    ],
    censor: "[REDACTED]",
  },
  base: {
    service: "sandbox-platform",
    version: process.env.npm_package_version || "1.0.0",
  },
});

// Child logger factory with trace ID
export function createRequestLogger(
  traceId: string,
  extra?: Record<string, unknown>,
) {
  return logger.child({ traceId, ...extra });
}

// Redact secrets from log output
export function redactSecrets(text: string): string {
  // Redact common secret patterns
  const patterns = [
    /SECRET_\w+=\S+/gi,
    /API_KEY=\S+/gi,
    /PASSWORD=\S+/gi,
    /TOKEN=\S+/gi,
    /PRIVATE_KEY=\S+/gi,
    /sk_live_[a-zA-Z0-9]+/gi,
    /sk_test_[a-zA-Z0-9]+/gi,
  ];

  let redacted = text;
  for (const pattern of patterns) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

export default logger;
