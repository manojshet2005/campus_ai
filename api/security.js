/* global process */
import { Buffer } from 'node:buffer'
import {
  getSupabaseUser,
  refreshSupabaseSession,
} from './supabaseAuth.js'

const refreshedCookies = new WeakMap()

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
      ...headers,
    },
  })
}

export function getBody(request) {
  return request.json().catch(() => null)
}

export function cookieValue(request, name) {
  const cookies = request.headers.get('cookie') || ''
  const match = cookies.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))
  if (!match) return null
  try {
    return decodeURIComponent(match.slice(name.length + 1))
  } catch {
    return null
  }
}

export function sessionCookie(token) {
  const secure = process.env.APP_URL?.startsWith('https://') || process.env.VERCEL === '1' ? '; Secure' : ''
  const value = Buffer.from(JSON.stringify({
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
  })).toString('base64url')
  return `campusvoice_session=${value}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=2592000`
}

export function clearSessionCookie() {
  const secure = process.env.APP_URL?.startsWith('https://') || process.env.VERCEL === '1' ? '; Secure' : ''
  return `campusvoice_session=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`
}

export async function requireSession(request, sql) {
  const cookie = cookieValue(request, 'campusvoice_session')
  if (!cookie) return null

  let session
  try {
    session = JSON.parse(Buffer.from(cookie, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof session.accessToken !== 'string' || typeof session.refreshToken !== 'string') return null

  let authUser = await getSupabaseUser(session.accessToken)
  if (!authUser) {
    const refreshed = await refreshSupabaseSession(session.refreshToken)
    if (!refreshed?.access_token || !refreshed?.refresh_token) return null
    session = refreshed
    refreshedCookies.set(request, sessionCookie(session))
    authUser = await getSupabaseUser(session.access_token)
    if (!authUser) return null
  }

  const rows = await sql`
    select u.id, u.name, u.email, u.role, u.student_id, u.department_id,
           d.name as department
    from users u
    left join departments d on d.id = u.department_id
    where u.auth_user_id = ${authUser.id}
      and u.account_status = 'active'
    limit 1
  `
  return rows[0] || null
}

export function applySessionRefresh(request, response) {
  const cookie = refreshedCookies.get(request)
  if (!cookie) return response
  const headers = new Headers(response.headers)
  headers.append('set-cookie', cookie)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export function requireRole(user, roles) {
  return Boolean(user && roles.includes(user.role))
}

export function checkSameOrigin(request) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return null
  const origin = request.headers.get('origin')
  if (!origin) return null
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return 'Cross-origin requests are not allowed.'
  }
  const allowedOrigins = new Set([new URL(request.url).origin])
  const configuredOrigins = [
    process.env.APP_URL,
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
    process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
  ]
  for (const configuredOrigin of configuredOrigins) {
    if (!configuredOrigin) continue
    try {
      allowedOrigins.add(new URL(configuredOrigin).origin)
    } catch {
      return 'The application origin configuration is invalid.'
    }
  }
  if (!allowedOrigins.has(origin)) return 'Cross-origin requests are not allowed.'
  return null
}

const rateBuckets = new Map()

export function checkRateLimit(request, scope, limit = 30, windowMs = 60000) {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
  const key = `${scope}:${ip}`
  const now = Date.now()
  const current = rateBuckets.get(key)
  if (!current || now >= current.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs })
    return null
  }
  current.count += 1
  if (current.count > limit) return 'Too many requests. Please try again later.'
  return null
}
