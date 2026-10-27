export const authConfig = {
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  cookieName: 'session',
  // Ida e volta do Google: state e PKCE vivem só nesse intervalo.
  oauthCookieTtlMs: 10 * 60 * 1000,
  oauthStateCookie: 'google_state',
  oauthVerifierCookie: 'google_verifier',
  // Quem voltou do Google sem conta tem esse tempo para escolher nome e inicial.
  signupTtlMs: 30 * 60 * 1000,
  signupCookie: 'signup',
  usernameMin: 3,
  usernameMax: 20,
  usernamePattern: /^[A-Za-z0-9_]+$/,
  userAgentMax: 500,
} as const

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string }

// GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e PUBLIC_URL (ex.: https://pocket.lontraeye.com).
// Sem os três, o login pelo Google fica desligado.
export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const publicUrl = process.env.PUBLIC_URL
  if (!clientId || !clientSecret || !publicUrl) return null
  return { clientId, clientSecret, redirectUri: `${publicUrl.replace(/\/$/, '')}/api/auth/google/callback` }
}
