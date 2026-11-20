import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from './[...path].js'
import { getSql } from './db.js'

vi.mock('./db.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getSql: vi.fn(),
    isDatabaseConfigured: vi.fn(() => true),
  }
})

describe('database API failures', () => {
  let consoleError

  beforeEach(() => {
    vi.clearAllMocks()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('returns a safe authentication diagnostic without exposing the underlying error', async () => {
    getSql.mockImplementation(() => {
      throw Object.assign(new Error('private connection details'), {
        name: 'PostgresError',
        code: '28P01',
      })
    })

    const response = await handler(new Request('https://campus.example/api/health'))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Database authentication failed.',
      code: 'DATABASE_AUTH_FAILED',
    })
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('28P01'))
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('private connection details'))
  })

  it('reports an invalid connection URL without leaking the URL', async () => {
    getSql.mockImplementation(() => {
      throw Object.assign(new TypeError('invalid private URL'), { code: 'ERR_INVALID_URL' })
    })

    const response = await handler(new Request('https://campus.example/api/health'))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'The database connection configuration is invalid.',
      code: 'DATABASE_CONFIGURATION_INVALID',
    })
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('invalid private URL'))
  })
})
