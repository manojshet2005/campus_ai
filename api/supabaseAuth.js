/* global process */

export class SupabaseAuthError extends Error {
  constructor(message, status = 503) {
    super(message)
    this.name = 'SupabaseAuthError'
    this.status = status
  }
}

function config() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, '')
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !publishableKey) {
    throw new SupabaseAuthError('Supabase Auth configuration is required.')
  }
  return { url, publishableKey }
}

async function authRequest(path, { method = 'POST', body, accessToken, admin = false } = {}) {
  const { url, publishableKey } = config()
  const secretKey = admin ? process.env.SUPABASE_SECRET_KEY?.trim() : null
  if (admin && !secretKey) {
    throw new SupabaseAuthError('Server-side Supabase administrator configuration is required.')
  }

  const key = secretKey || publishableKey
  const headers = { apikey: key }
  if (accessToken) headers.authorization = `Bearer ${accessToken}`
  if (admin) headers.authorization = `Bearer ${secretKey}`
  if (body !== undefined) headers['content-type'] = 'application/json'

  let response
  try {
    response = await fetch(`${url}/auth/v1/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new SupabaseAuthError('Supabase Auth is temporarily unavailable.')
  }

  const data = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, data }
}

function throwAuthError(result, fallback, defaultStatus) {
  if (result.ok) return result.data
  const status = result.status === 429 ? 429 : defaultStatus
  throw new SupabaseAuthError(fallback, status)
}

export function isSupabaseAuthConfigured() {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_PUBLISHABLE_KEY?.trim())
}

export async function signUpWithPassword({ email, password, name, studentId, department }) {
  const result = await authRequest('signup', {
    body: {
      email,
      password,
      data: { name, student_id: studentId, department },
    },
  })
  return throwAuthError(result, 'Supabase could not create this account.', result.status === 409 ? 409 : 400)
}

export async function signInWithPassword({ email, password }) {
  const result = await authRequest('token?grant_type=password', {
    body: { email, password },
  })
  return throwAuthError(result, 'Invalid email or password.', result.status === 429 ? 429 : 401)
}

export async function getSupabaseUser(accessToken) {
  const result = await authRequest('user', { method: 'GET', accessToken })
  return result.ok ? result.data : null
}

export async function refreshSupabaseSession(refreshToken) {
  const result = await authRequest('token?grant_type=refresh_token', {
    body: { refresh_token: refreshToken },
  })
  return result.ok ? result.data : null
}

export async function signOutSupabase(accessToken) {
  if (!accessToken) return
  await authRequest('logout', { accessToken })
}

export async function createSupabaseAdminUser({ email, password, name }) {
  const result = await authRequest('admin/users', {
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    },
    admin: true,
  })
  return throwAuthError(result, 'Supabase could not provision this administrator.', result.status === 409 ? 409 : 400)
}
