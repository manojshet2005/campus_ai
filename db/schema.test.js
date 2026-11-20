import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const schemaPromise = readFile(new URL('./schema.sql', import.meta.url), 'utf8')

describe('Supabase schema security declarations', () => {
  it('enables RLS on every application data table', async () => {
    const schema = await schemaPromise
    const tables = [
      'departments',
      'users',
      'complaints',
      'complaint_analyses',
      'complaint_embeddings',
      'issue_groups',
      'issue_group_members',
      'status_history',
      'notifications',
      'safeguarding_cases',
      'internal_notes',
      'management_reports',
      'management_actions',
      'feedback',
      'audit_logs',
      'ai_requests',
    ]

    for (const table of tables) {
      expect(schema).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`)
    }
  })

  it('creates only student profiles from public Auth signups', async () => {
    const schema = await schemaPromise
    expect(schema).toMatch(/'student',\s*new\.raw_user_meta_data ->> 'student_id'/)
    expect(schema).toContain('ON CONFLICT (email) DO UPDATE')
    expect(schema).toContain('public.users.role = \'student\'')
  })

  it('keeps legacy password hashes out of client-readable columns', async () => {
    const schema = await schemaPromise
    expect(schema).toContain('REVOKE ALL ON public.users FROM PUBLIC, anon, authenticated;')
    expect(schema).toContain('legacy_password_hash')
    expect(schema).not.toMatch(/GRANT SELECT\s*\([^)]*legacy_password_hash/is)
  })

  it('does not let authenticated users update protected profiles or arbitrary complaint columns', async () => {
    const schema = await schemaPromise
    expect(schema).toContain('REVOKE ALL ON public.departments, public.users, public.complaints,')
    expect(schema).not.toMatch(/GRANT\s+(UPDATE|INSERT|DELETE)\s+ON\s+public\.(users|complaints|notifications|feedback)/i)
    expect(schema).not.toContain('CREATE POLICY users_update_student_profile')
  })

  it('keeps the migration ledger inaccessible to application roles', async () => {
    const schema = await schemaPromise
    expect(schema).toContain('ALTER TABLE public.app_schema_migrations ENABLE ROW LEVEL SECURITY;')
    expect(schema).toMatch(/public\.app_schema_migrations\s+FROM PUBLIC, anon, authenticated;/)
  })

  it('restricts student complaints and safeguarding records by profile and role', async () => {
    const schema = await schemaPromise
    expect(schema).toContain("(u.role = 'student' AND c.student_id = u.id)")
    expect(schema).toContain("(u.role = 'departmentAdmin' AND c.suggested_department_id = u.department_id AND c.is_safety_restricted = FALSE)")
    expect(schema).toContain("(u.role = 'safeguardingOfficer' AND c.is_safety_restricted = TRUE)")
    expect(schema).toContain("public.current_app_role() IN ('superAdmin', 'safeguardingOfficer')")
  })
})
