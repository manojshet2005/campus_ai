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
/* global process */
