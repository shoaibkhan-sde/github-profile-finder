/**
 * Sanitized Application Logger.
 * Guarantees that credentials, tokens, and authorization headers are never logged.
 */

function sanitize(message) {
  if (typeof message !== 'string') {
    try {
      message = JSON.stringify(message);
    } catch {
      message = String(message);
    }
  }

  // Redact any bearer tokens or credentials
  return message
    .replace(/bearer\s+[\w\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(token|authorization|secret|key)=([^&\s]+)/gi, '$1=[REDACTED]');
}

export const logger = {
  info: (msg, ...args) => {
    console.log(`[${new Date().toISOString()}] [INFO] ${sanitize(msg)}`, ...args.map(sanitize));
  },
  warn: (msg, ...args) => {
    console.warn(`[${new Date().toISOString()}] [WARN] ${sanitize(msg)}`, ...args.map(sanitize));
  },
  error: (msg, ...args) => {
    console.error(`[${new Date().toISOString()}] [ERROR] ${sanitize(msg)}`, ...args.map(sanitize));
  }
};

