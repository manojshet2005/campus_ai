import crypto from 'node:crypto'
/* global process */

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

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex')
}

export function cookieValue(request, name) {
  const cookies = request.headers.get('cookie') || ''
  const match = cookies.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null
}

export function sessionCookie(token) {
  const secure = process.env.APP_URL?.startsWith('https://') ? '; Secure' : ''
  return `campusvoice_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=604800`
}

export function clearSessionCookie() {
  const secure = process.env.APP_URL?.startsWith('https://') ? '; Secure' : ''
  return `campusvoice_session=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`
}

export async function requireSession(request, sql) {
  const token = cookieValue(request, 'campusvoice_session')
  if (!token) return null

  const rows = await sql`
    select u.id, u.name, u.email, u.role, u.student_id, u.department_id,
           d.name as department
    from sessions s
    join users u on u.id = s.user_id
    left join departments d on d.id = u.department_id
    where s.token_hash = ${sha256(token)}
      and s.revoked_at is null
      and s.expires_at > now()
      and u.account_status = 'active'
    limit 1
  `
  return rows[0] || null
}

export function requireRole(user, roles) {
  return Boolean(user && roles.includes(user.role))
}

export function checkSameOrigin(request) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return null
  const origin = request.headers.get('origin')
  if (!origin) return null
  const appUrl = process.env.APP_URL
  if (appUrl && origin !== new URL(appUrl).origin) {
    return 'Cross-origin requests are not allowed.'
  }
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
