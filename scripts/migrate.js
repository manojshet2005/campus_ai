import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import postgres from 'postgres'
/* global process */

const connectionString = process.env.DATABASE_URL_MIGRATIONS?.trim() || process.env.DATABASE_URL?.trim()
if (!connectionString) {
  console.error('Set DATABASE_URL_MIGRATIONS or DATABASE_URL before running migrations.')
  process.exit(1)
}

const sql = postgres(connectionString, {
  ssl: 'require',
  max: 1,
  prepare: false,
  connect_timeout: 15,
})
try {
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')
  const checksum = createHash('sha256').update(schema).digest('hex')
  await sql.begin(async (tx) => {
    await tx.unsafe(schema)
    await tx`
      insert into public.app_schema_migrations (version, checksum)
      values ('supabase-baseline-v1', ${checksum})
      on conflict (version) do update
      set checksum = excluded.checksum, applied_at = now()
    `
  })

  const verification = await sql`
    select
      count(*) filter (where c.relrowsecurity)::int as rls_tables,
      count(*)::int as total_tables
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname in (
        'departments', 'users', 'complaints', 'complaint_analyses',
        'complaint_embeddings', 'issue_groups', 'issue_group_members',
        'status_history', 'notifications', 'safeguarding_cases',
        'internal_notes', 'management_reports', 'management_actions',
        'feedback', 'audit_logs', 'ai_requests'
      )
  `
  const { rls_tables: rlsTables, total_tables: totalTables } = verification[0]
  if (totalTables !== 16 || rlsTables !== 16) {
    throw new Error('Database table or row-level-security verification failed.')
  }
  const vectorIndex = await sql`
    select exists (
      select 1 from pg_indexes
      where schemaname = 'public' and indexname = 'idx_complaints_vector_cosine'
    ) as exists
  `
  if (!vectorIndex[0].exists) throw new Error('The semantic vector index was not created.')

  console.log(`Supabase migration and verification succeeded (${totalTables} tables with RLS).`)
} catch (error) {
  console.error(`Supabase migration failed (${error?.code || error?.name || 'unknown error'}).`)
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
