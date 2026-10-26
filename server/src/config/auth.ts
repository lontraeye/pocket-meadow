export const authConfig = {
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  cookieName: 'session',
  usernameMin: 3,
  usernameMax: 20,
  usernamePattern: /^[A-Za-z0-9_]+$/,
  passwordMin: 8,
  passwordMax: 128,
  userAgentMax: 500,
} as const
