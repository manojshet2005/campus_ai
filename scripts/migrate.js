import { readFile } from 'node:fs/promises'
import postgres from 'postgres'
/* global process */

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!connectionString) {
  console.error('Set DATABASE_URL_UNPOOLED or DATABASE_URL before running migrations.')
  process.exit(1)
}

const sql = postgres(connectionString, { ssl: 'require', max: 1 })
try {
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')
  await sql.begin(async (tx) => {
    await tx.unsafe(schema)
  })
  console.log('CampusVoice database schema migration completed.')
} finally {
  await sql.end({ timeout: 5 })
}
