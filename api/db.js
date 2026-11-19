import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL

export function isDatabaseConfigured() {
  return Boolean(connectionString)
}

export function getSql() {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured.')
  }
  return postgres(connectionString, {
    ssl: 'require',
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  })
}
/* global process */
