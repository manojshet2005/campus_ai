import postgres from 'postgres'

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim())
}

export function getSql() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured.')
  }
  return postgres(connectionString, {
    ssl: 'require',
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
  })
}
export function classifyError(error) {
  const code = typeof error?.code === 'string' || typeof error?.code === 'number'
    ? String(error.code)
    : null
  const name = typeof error?.name === 'string' ? error.name : 'Error'
  let category = 'internal_error'

  if (name === 'PostgresError' || (code && (/^28/.test(code) || /^08/.test(code) || /^3D/.test(code) || /^42/.test(code)))) {
    if (code === '28P01' || code === '28000') {
      category = 'db_auth_failure'
    } else if (code === '3D000') {
      category = 'db_database_not_found'
    } else if (/^08/.test(code)) {
      category = 'db_connection_failure'
    } else if (/^42/.test(code)) {
      category = 'db_schema_error'
    } else {
      category = 'db_query_failure'
    }
  } else if (code && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'CONNECT_TIMEOUT'].includes(code)) {
    category = 'db_connection_failure'
  } else if (code && (code.startsWith('ERR_SSL_') || code.startsWith('CERT_') || ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT'].includes(code))) {
    category = 'db_ssl_failure'
  } else if (code === 'ERR_INVALID_URL' || (name === 'TypeError' && code === 'ERR_INVALID_URL')) {
    category = 'invalid_connection_url'
  } else if (code === 'DATABASE_NOT_CONFIGURED') {
    category = 'missing_environment_variable'
  } else if (name === 'ZodError') {
    category = 'validation_failure'
  } else if (name === 'SupabaseAuthError') {
    category = 'auth_service_failure'
  }

  return { name, code, category }
}
/* global process */
