/* global process */
import { afterEach, describe, expect, it } from 'vitest'
import { checkSameOrigin, cookieValue, sessionCookie } from './security.js'

const originalVercel = process.env.VERCEL
const originalAppUrl = process.env.APP_URL

afterEach(() => {
  if (originalVercel === undefined) delete process.env.VERCEL
  else process.env.VERCEL = originalVercel
  if (originalAppUrl === undefined) delete process.env.APP_URL
  else process.env.APP_URL = originalAppUrl
})

describe('API request security', () => {
  it('rejects cross-origin writes and accepts the request origin', () => {
    const request = new Request('https://campus.example/api/complaints', {
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
    })
    expect(checkSameOrigin(request)).toBe('Cross-origin requests are not allowed.')

    const sameOrigin = new Request('https://campus.example/api/complaints', {
      method: 'POST',
      headers: { origin: 'https://campus.example' },
    })
    expect(checkSameOrigin(sameOrigin)).toBeNull()
  })

  it('marks production session cookies Secure and tolerates malformed cookies', () => {
    process.env.VERCEL = '1'
    expect(sessionCookie({ access_token: 'access', refresh_token: 'refresh' })).toContain('; Secure;')
    expect(cookieValue(new Request('https://campus.example', {
      headers: { cookie: 'campusvoice_session=%not-valid' },
    }), 'campusvoice_session')).toBeNull()
  })
})
