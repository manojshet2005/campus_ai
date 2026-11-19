import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSupabaseAdminUser,
  getSupabaseUser,
  signInWithPassword,
  signUpWithPassword,
} from './supabaseAuth.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Supabase Auth server integration', () => {
  it('uses the publishable key for student signup and never sends server secrets', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://campus.example')
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'server_test_key')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      user: { id: 'auth-user-id' },
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await signUpWithPassword({
      email: 'student@example.test',
      password: 'a-secure-password',
      name: 'Student',
      studentId: 'S-100',
      department: 'Engineering',
    })

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://campus.example/auth/v1/signup')
    expect(options.headers.apikey).toBe('sb_publishable_test')
    expect(options.headers.authorization).toBeUndefined()
    expect(options.body).toContain('"student_id":"S-100"')
  })

  it('uses the secret key only for server-side administrator provisioning', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://campus.example')
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'server_test_key')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'admin-auth-id',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await createSupabaseAdminUser({
      email: 'admin@example.test',
      password: 'a-secure-admin-password',
      name: 'Administrator',
    })

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://campus.example/auth/v1/admin/users')
    expect(options.headers.apikey).toBe('server_test_key')
    expect(options.headers.authorization).toBe('Bearer server_test_key')
  })

  it('returns no user for an invalid access token', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://campus.example')
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))

    await expect(getSupabaseUser('expired-token')).resolves.toBeNull()
  })

  it('surfaces invalid credentials as an authentication failure', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://campus.example')
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 400 })))

    await expect(signInWithPassword({
      email: 'student@example.test',
      password: 'incorrect-password',
    })).rejects.toMatchObject({ status: 401 })
  })
})
