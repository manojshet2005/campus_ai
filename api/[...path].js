/* global process */
import { Buffer } from 'node:buffer'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { GoogleGenAI } from '@google/genai'
import { getSql, isDatabaseConfigured } from './db.js'
import { aggregateComplaintRecords } from './reporting.js'
import {
  createSupabaseAdminUser,
  isSupabaseAuthConfigured,
  signInWithPassword,
  signOutSupabase,
  signUpWithPassword,
} from './supabaseAuth.js'
import {
  applySessionRefresh,
  clearSessionCookie,
  checkRateLimit,
  checkSameOrigin,
  getBody,
  json,
  requireRole,
  requireSession,
  sessionCookie,
} from './security.js'

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(255),
  password: z.string().min(10).max(128),
  studentId: z.string().trim().min(2).max(80),
  department: z.string().trim().min(1).max(120).optional(),
})

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(128),
})

const complaintSchema = z.object({
  originalComplaint: z.string().trim().min(10).max(10000),
  category: z.string().trim().min(1).max(80),
  subcategory: z.string().trim().min(1).max(120),
  customCategory: z.string().trim().max(120).optional(),
  isAnonymous: z.boolean().optional(),
})

const analysisSchema = z.object({
  summary: z.string().min(1).max(500),
  category: z.string().min(1).max(80),
  subcategory: z.string().min(1).max(120),
  suggestedDepartment: z.string().min(1).max(120),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  urgency: z.enum(['LOW', 'NORMAL', 'URGENT', 'IMMEDIATE']),
  sentiment: z.enum(['POSITIVE', 'NEGATIVE', 'FRUSTRATED', 'ANGRY', 'FEARFUL', 'DISTRESSED', 'NEUTRAL']),
  issueType: z.string().min(1).max(180),
  keywords: z.array(z.string().min(1).max(50)).min(1).max(12),
  safetyFlags: z.array(z.string().min(1).max(80)).max(20),
  requiresHumanReview: z.boolean(),
  explanation: z.string().min(1).max(1000),
  recommendation: z.string().min(1).max(1000),
})

const reportSummarySchema = z.object({
  summary: z.string().min(1).max(1200),
  recommendations: z.array(z.string().min(1).max(400)).max(5),
})

const SAFETY_PATTERNS = [
  /\b(suicide|self[- ]?harm|kill myself|end my life)\b/i,
  /\b(physical harm|being attacked|sexual assault|rape|violence|threatening)\b/i,
  /\b(ragging|bully(?:ing)?|harass(?:ment|ed)?|intimidation)\b/i,
]

function deterministicSafetyFlags(text) {
  return SAFETY_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source)
}

const CATEGORY_DEPARTMENTS = {
  Hostel: 'Hostel Administration',
  Academics: 'Academic Administration',
  Faculty: 'Faculty Administration',
  Canteen: 'Canteen Management',
  Infrastructure: 'Infrastructure Department',
  Administration: 'General Administration',
  Transportation: 'Transport Department',
  'Student Welfare & Safety': 'Student Welfare',
  'Placement & Career': 'Placement Cell',
  'Campus Environment': 'Infrastructure Department',
}

function publicUser(row) {
  return {
    uid: row.id,
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    studentId: row.student_id,
    department: row.department || null,
  }
}

async function callGemini(text, category, subcategory, customCategory) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.')
  const ai = new GoogleGenAI({ apiKey })
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'
  const prompt = `Analyze this campus complaint for institutional response. Return only strict JSON.
Selected category: ${category}
Selected subcategory: ${subcategory}
Custom category: ${customCategory || ''}
Complaint: ${text}
Allowed priorities: LOW, MEDIUM, HIGH, CRITICAL
Allowed urgency: LOW, NORMAL, URGENT, IMMEDIATE
Allowed sentiment: POSITIVE, NEGATIVE, FRUSTRATED, ANGRY, FEARFUL, DISTRESSED, NEUTRAL
Safety indicators require human review but are not diagnoses.`

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  })
  const raw = response.text
  let parsed
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    throw new Error('Gemini returned invalid JSON.')
  }
  return { analysis: analysisSchema.parse(parsed), model }
}

async function callEmbedding(text) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.')
  const ai = new GoogleGenAI({ apiKey })
  const model = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2'
  const result = await ai.models.embedContent({
    model,
    contents: `task: sentence similarity | query: ${text}`,
    config: { outputDimensionality: 768 },
  })
  const embedding = result.embeddings?.[0]?.values
  if (!Array.isArray(embedding) || embedding.length !== 768 || !embedding.every(Number.isFinite)) {
    throw new Error('Gemini returned an invalid embedding.')
  }
  return { embedding, model }
}

async function callGeminiReportSummary(report) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.')
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'
  const ai = new GoogleGenAI({ apiKey })
  const response = await ai.models.generateContent({
    model,
    contents: `Summarize these aggregate campus complaint statistics for management. Do not infer individual identities or claim causation. Return JSON with "summary" and "recommendations" (array of at most 5 strings).\n${JSON.stringify(report)}`,
    config: { responseMimeType: 'application/json' },
  })
  let result
  try {
    result = JSON.parse(response.text)
  } catch {
    throw new Error('Gemini returned invalid JSON.')
  }
  return reportSummarySchema.parse(result)
}

async function handleRequest(request) {
  const originError = checkSameOrigin(request)
  if (originError) return json(403, { error: originError })
  const rateError = checkRateLimit(request, 'api', 120)
  if (rateError) return json(429, { error: rateError })

  if (!isDatabaseConfigured()) {
    return json(503, { error: 'Database configuration required.', code: 'DATABASE_NOT_CONFIGURED' })
  }

  const sql = getSql()
  const url = new URL(request.url)
  const pathname = url.pathname.replace(/^\/api/, '').replace(/\/$/, '') || '/'
  const method = request.method
  if (pathname.startsWith('/auth/') && !isSupabaseAuthConfigured()) {
    await sql.end({ timeout: 5 }).catch(() => {})
    return json(503, { error: 'Supabase Auth configuration required.', code: 'SUPABASE_AUTH_NOT_CONFIGURED' })
  }

  try {
    if (pathname === '/health' && method === 'GET') {
      await sql`select 1 as database_ready`
      return json(200, {
        database: 'connected',
        supabaseAuthConfigured: isSupabaseAuthConfigured(),
      })
    }

    if (pathname === '/admin/bootstrap' && method === 'POST') {
      const secret = request.headers.get('x-admin-bootstrap-secret')
      if (!process.env.ADMIN_BOOTSTRAP_SECRET || secret !== process.env.ADMIN_BOOTSTRAP_SECRET) {
        return json(403, { error: 'Invalid administrator bootstrap secret.' })
      }
      const bootstrapLimit = checkRateLimit(request, 'admin-bootstrap', 3, 60 * 60 * 1000)
      if (bootstrapLimit) return json(429, { error: bootstrapLimit })
      const body = await getBody(request)
      const bootstrapSchema = z.object({
        name: z.string().trim().min(2).max(120),
        email: z.string().trim().email().max(255),
        password: z.string().min(12).max(128),
        role: z.enum(['superAdmin', 'managementViewer', 'departmentAdmin', 'safeguardingOfficer']),
        department: z.string().trim().max(120).optional(),
      })
      const parsed = bootstrapSchema.safeParse(body)
      if (!parsed.success) return json(400, { error: 'Invalid administrator provisioning data.' })
      if (parsed.data.role === 'departmentAdmin' && !parsed.data.department) {
        return json(400, { error: 'Department administrators require an assigned department.' })
      }
      const existingRows = await sql`
        select id, role, auth_user_id, department_id
        from users where lower(email) = lower(${parsed.data.email}) limit 1
      `
      const existing = existingRows[0]
      if (existing?.auth_user_id) return json(409, { error: 'An account with this email already exists.' })
      if (existing && (!requireRole(existing, ['superAdmin', 'managementViewer', 'departmentAdmin', 'safeguardingOfficer'])
        || existing.role !== parsed.data.role)) {
        return json(409, { error: 'The existing profile role cannot be changed through administrator bootstrap.' })
      }
      let departmentId = null
      if (parsed.data.department) {
        const department = await sql`select id from departments where lower(name) = lower(${parsed.data.department}) limit 1`
        if (!department[0]) return json(400, { error: 'The selected department does not exist.' })
        departmentId = department[0].id
      }
      if (existing && existing.department_id !== departmentId) {
        return json(409, { error: 'The existing administrator department cannot be changed during bootstrap.' })
      }
      const authUser = await createSupabaseAdminUser({
        email: parsed.data.email.toLowerCase(),
        password: parsed.data.password,
        name: parsed.data.name,
      })
      if (existing) {
        await sql`
          update users
          set auth_user_id = ${authUser.id}, name = ${parsed.data.name},
              legacy_password_hash = null, updated_at = now()
          where id = ${existing.id} and auth_user_id is null
        `
      } else {
        await sql`
          insert into users (id, auth_user_id, name, email, role, department_id)
          values (${authUser.id}, ${authUser.id}, ${parsed.data.name}, ${parsed.data.email.toLowerCase()}, ${parsed.data.role}, ${departmentId})
          on conflict (auth_user_id) do update
            set name = excluded.name, email = excluded.email, role = excluded.role,
                department_id = excluded.department_id, account_status = 'active',
                updated_at = now()
        `
      }
      await sql`
        insert into audit_logs (action, entity_type, details)
        values ('bootstrap_administrator', 'user', ${JSON.stringify({ role: parsed.data.role })}::jsonb)
      `
      return json(201, { ok: true })
    }

    if (pathname === '/auth/register' && method === 'POST') {
      const registrationLimit = checkRateLimit(request, 'register', 5, 15 * 60 * 1000)
      if (registrationLimit) return json(429, { error: registrationLimit })
      const parsed = registerSchema.safeParse(await getBody(request))
      if (!parsed.success) return json(400, { error: 'Invalid registration data.' })
      const body = parsed.data
      const existing = await sql`select id from users where lower(email) = lower(${body.email}) limit 1`
      if (existing.length) return json(409, { error: 'An account with this email already exists.' })
      const authResult = await signUpWithPassword({
        email: body.email.toLowerCase(),
        password: body.password,
        name: body.name,
        studentId: body.studentId,
        department: body.department || 'General Administration',
      })
      if (!authResult.user?.id) {
        return json(502, { error: 'Supabase did not return a user record.' })
      }
      const department = await sql`select id, name from departments where lower(name) = lower(${body.department || 'General Administration'}) limit 1`
      const departmentId = department[0]?.id || null
      const rows = await sql`
        update users
        set name = ${body.name}, email = ${body.email.toLowerCase()},
            student_id = ${body.studentId}, department_id = ${departmentId},
            updated_at = now()
        where auth_user_id = ${authResult.user.id} and role = 'student'
        returning id, name, email, role, student_id, department_id
      `
      const row = rows[0]
      if (!row) return json(409, { error: 'An account with this email already exists.' })
      if (!authResult.access_token || !authResult.refresh_token) {
        return json(201, {
          confirmationRequired: true,
          message: 'Check your email to confirm your account, then sign in.',
        })
      }
      return json(201, {
        user: publicUser({ ...row, department: department[0]?.name || null }),
      }, { 'set-cookie': sessionCookie(authResult) })
    }

    if (pathname === '/auth/login' && method === 'POST') {
      const loginLimit = checkRateLimit(request, 'login', 10, 15 * 60 * 1000)
      if (loginLimit) return json(429, { error: loginLimit })
      const parsed = loginSchema.safeParse(await getBody(request))
      if (!parsed.success) return json(400, { error: 'Invalid login data.' })
      const body = parsed.data
      let authResult
      try {
        authResult = await signInWithPassword({ email: body.email.toLowerCase(), password: body.password })
      } catch (authError) {
        if (authError.status !== 401) throw authError
        const legacyRows = await sql`
          select id, name, email, role, auth_user_id, legacy_password_hash
          from users where lower(email) = lower(${body.email}) limit 1
        `
        const legacyUser = legacyRows[0]
        if (!legacyUser?.legacy_password_hash || legacyUser.auth_user_id
          || !(await bcrypt.compare(body.password, legacyUser.legacy_password_hash))) {
          throw authError
        }
        const createdAuthUser = await createSupabaseAdminUser({
          email: legacyUser.email,
          password: body.password,
          name: legacyUser.name,
        })
        const linkedRows = await sql`
          update users
          set auth_user_id = ${createdAuthUser.id},
              legacy_password_hash = null,
              updated_at = now()
          where id = ${legacyUser.id}
            and (auth_user_id is null or auth_user_id = ${createdAuthUser.id})
          returning id
        `
        if (!linkedRows[0]) {
          return json(500, { error: 'The legacy account could not be linked. Contact an administrator.' })
        }
        await sql`
          insert into audit_logs (actor_id, action, entity_type, entity_id, details)
          values (${legacyUser.id}, 'migrate_legacy_auth', 'user', ${legacyUser.id},
            ${JSON.stringify({ role: legacyUser.role })}::jsonb)
        `
        authResult = await signInWithPassword({ email: body.email.toLowerCase(), password: body.password })
      }
      const rows = await sql`
        select u.id, u.name, u.email, u.role, u.student_id, u.account_status,
               d.name as department
        from users u left join departments d on d.id = u.department_id
        where u.auth_user_id = ${authResult.user.id} limit 1
      `
      const row = rows[0]
      if (!row || row.account_status !== 'active') return json(403, { error: 'This account is not active.' })
      return json(200, { user: publicUser(row) }, { 'set-cookie': sessionCookie(authResult) })
    }

    if (pathname === '/auth/logout' && method === 'POST') {
      const encoded = (request.headers.get('cookie') || '')
        .split(';').map((item) => item.trim()).find((item) => item.startsWith('campusvoice_session='))?.slice('campusvoice_session='.length)
      if (encoded) {
        try {
          const session = JSON.parse(Buffer.from(decodeURIComponent(encoded), 'base64url').toString('utf8'))
          await signOutSupabase(session.accessToken).catch(() => {})
        } catch {
          // A malformed local cookie is cleared regardless.
        }
      }
      return json(200, { ok: true }, { 'set-cookie': clearSessionCookie() })
    }

    if (pathname === '/auth/session' && method === 'GET') {
      const user = await requireSession(request, sql)
      return json(200, { user: user ? publicUser(user) : null })
    }

    const user = await requireSession(request, sql)
    if (!user) return json(401, { error: 'Authentication required.' })

    if (pathname === '/complaints' && method === 'GET') {
      let rows
      if (user.role === 'student') {
        rows = await sql`select c.*, ca.summary, ca.priority, ca.urgency, ca.sentiment, ca.safety_flags, ca.recommendation,
          ce.embedding::text as embedding_text,
          coalesce((select jsonb_agg(jsonb_build_object('status', sh.to_status, 'timestamp', sh.created_at) order by sh.created_at)
            from status_history sh where sh.complaint_id = c.id), '[]'::jsonb) as status_history
          from complaints c
          left join complaint_analyses ca on ca.complaint_id = c.id
          left join complaint_embeddings ce on ce.complaint_id = c.id
          where c.student_id = ${user.id} order by c.created_at desc limit 200`
      } else if (user.role === 'departmentAdmin') {
        rows = await sql`select c.*, ca.summary, ca.priority, ca.urgency, ca.sentiment, ca.safety_flags, ca.recommendation
          from complaints c left join complaint_analyses ca on ca.complaint_id = c.id
          where c.suggested_department_id = ${user.department_id} and c.is_safety_restricted = false
          order by c.created_at desc limit 500`
      } else if (user.role === 'safeguardingOfficer') {
        rows = await sql`select c.*, ca.summary, ca.priority, ca.urgency, ca.sentiment, ca.safety_flags, ca.recommendation
          from complaints c left join complaint_analyses ca on ca.complaint_id = c.id
          where c.is_safety_restricted = true order by c.created_at desc limit 500`
      } else if (user.role === 'managementViewer') {
        rows = await sql`select c.*, ca.summary, ca.priority, ca.urgency, ca.sentiment, ca.safety_flags, ca.recommendation
          from complaints c left join complaint_analyses ca on ca.complaint_id = c.id
          where c.is_safety_restricted = false order by c.created_at desc limit 1000`
      } else {
        rows = await sql`select c.*, ca.summary, ca.priority, ca.urgency, ca.sentiment, ca.safety_flags, ca.recommendation
          from complaints c left join complaint_analyses ca on ca.complaint_id = c.id
          order by c.created_at desc limit 1000`
      }
      return json(200, { complaints: rows })
    }

    if (pathname === '/complaints' && method === 'POST') {
      if (user.role !== 'student') return json(403, { error: 'Only students may submit complaints.' })
      const parsed = complaintSchema.safeParse(await getBody(request))
      if (!parsed.success) return json(400, { error: 'Invalid complaint data.' })
      const body = parsed.data

      let ai
      let embedding
      try {
        ai = await callGemini(body.originalComplaint, body.category, body.subcategory, body.customCategory)
        embedding = await callEmbedding(body.originalComplaint)
      } catch (error) {
        try {
          await sql`
            insert into ai_requests (request_type, model_name, status, error_code)
            values (
              'complaint_analysis',
              ${process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'},
              'failed',
              ${String(error?.status || error?.name || 'unknown').slice(0, 120)}
            )
          `
        } catch (logError) {
          console.error('AI failure telemetry could not be recorded:', logError?.name || 'Error')
        }
        return json(502, { error: 'Gemini analysis is unavailable. No complaint was stored.' })
      }

      const independentSafetyFlags = deterministicSafetyFlags(body.originalComplaint)
      const modelSafetyFlags = Array.isArray(ai.analysis.safetyFlags) ? ai.analysis.safetyFlags : []
      const mergedSafetyFlags = [...new Set([
        ...independentSafetyFlags,
        ...modelSafetyFlags,
      ])]
      const isRestricted = mergedSafetyFlags.length > 0
      const safeDepartmentName = CATEGORY_DEPARTMENTS[body.category]
        || CATEGORY_DEPARTMENTS[ai.analysis.category]
        || 'General Administration'
      const departmentRows = await sql`
        select id from departments where lower(name) = lower(${safeDepartmentName}) limit 1
      `
      const departmentId = departmentRows[0]?.id || null
      const publicId = `CV-${Date.now()}`

      const complaint = await sql.begin(async (tx) => {
        const inserted = await tx`
          insert into complaints (
            public_id, student_id, original_complaint, selected_category, selected_subcategory,
            custom_category, category, subcategory, suggested_department_id, priority, urgency,
            sentiment, is_anonymous, is_safety_restricted
          ) values (
            ${publicId}, ${user.id}, ${body.originalComplaint}, ${body.category}, ${body.subcategory},
            ${body.customCategory || null}, ${ai.analysis.category}, ${ai.analysis.subcategory},
            ${departmentId}, ${ai.analysis.priority}, ${ai.analysis.urgency}, ${ai.analysis.sentiment},
            ${body.isAnonymous || false}, ${isRestricted}
          ) returning *
        `
        const complaintRow = inserted[0]
        await tx`
          insert into complaint_analyses (
            complaint_id, summary, category, subcategory, suggested_department, priority, urgency,
            sentiment, issue_type, keywords, safety_flags, requires_human_review, explanation, recommendation, model_name
          ) values (
            ${complaintRow.id}, ${ai.analysis.summary}, ${ai.analysis.category}, ${ai.analysis.subcategory},
            ${ai.analysis.suggestedDepartment}, ${ai.analysis.priority}, ${ai.analysis.urgency},
            ${ai.analysis.sentiment}, ${ai.analysis.issueType},             ${JSON.stringify(ai.analysis.keywords)}::jsonb,
            ${JSON.stringify(mergedSafetyFlags)}::jsonb, ${ai.analysis.requiresHumanReview || isRestricted},
            ${ai.analysis.explanation}, ${ai.analysis.recommendation}, ${ai.model}
          )
        `
        await tx`
          insert into complaint_embeddings (complaint_id, embedding, model_name)
          values (${complaintRow.id}, ${JSON.stringify(embedding.embedding)}::extensions.vector, ${embedding.model})
        `
        await tx`
          insert into status_history (complaint_id, to_status, actor_id, note)
          values (${complaintRow.id}, 'Submitted', ${user.id}, 'Complaint submitted')
        `
        await tx`
          insert into notifications (recipient_id, title, text, complaint_id)
          values (${user.id}, 'Complaint submitted', 'Your complaint has been received and is awaiting review.', ${complaintRow.id})
        `
        if (isRestricted) {
          await tx`
            insert into safeguarding_cases (complaint_id, status)
            values (${complaintRow.id}, 'Open')
          `
        }
        await tx`
          insert into ai_requests (request_type, model_name, status)
          values ('complaint_analysis', ${ai.model}, 'success')
        `
        const nearby = await tx`
          select ig.id,
                 1 - (ce.embedding OPERATOR(extensions.<=>) ${JSON.stringify(embedding.embedding)}::extensions.vector) as similarity
          from issue_groups ig
          join issue_group_members igm on igm.issue_group_id = ig.id
          join complaint_embeddings ce on ce.complaint_id = igm.complaint_id
          where ig.department_id = ${departmentId}
            and ig.is_safety_restricted = ${isRestricted}
          order by ce.embedding OPERATOR(extensions.<=>) ${JSON.stringify(embedding.embedding)}::extensions.vector
          limit 1
        `
        let issueGroupId = nearby[0]?.id
        if (!issueGroupId || Number(nearby[0].similarity) < 0.78) {
          const createdGroup = await tx`
            insert into issue_groups (
              title, department_id, is_safety_restricted, representative_complaint_id, summary,
              first_reported, latest_reported
            ) values (
              ${`${ai.analysis.category} - ${ai.analysis.subcategory}`},
              ${departmentId}, ${isRestricted}, ${complaintRow.id}, ${ai.analysis.summary},
              now(), now()
            ) returning id
          `
          issueGroupId = createdGroup[0].id
        } else {
          await tx`
            update issue_groups
            set summary = ${ai.analysis.summary},
                latest_reported = now(),
                updated_at = now()
            where id = ${issueGroupId}
          `
        }
        await tx`
          insert into issue_group_members (issue_group_id, complaint_id, similarity_score)
          values (${issueGroupId}, ${complaintRow.id}, ${nearby[0]?.similarity || 1})
          on conflict (issue_group_id, complaint_id) do update
          set similarity_score = excluded.similarity_score
        `
        return complaintRow
      })

      return json(201, { complaint: complaint })
    }

    if (pathname.startsWith('/complaints/') && pathname.endsWith('/feedback') && method === 'POST') {
        if (user.role !== 'student') return json(403, { error: 'Only students may submit feedback.' })
        const id = decodeURIComponent(pathname.split('/')[2])
        const body = await getBody(request)
        const ratingSchema = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() })
        const parsed = ratingSchema.safeParse(body)
        if (!parsed.success) return json(400, { error: 'Invalid feedback.' })
        const currentRows = await sql`
          select id, student_id, status from complaints
          where (id = ${id} or public_id = ${id}) limit 1
        `
        const current = currentRows[0]
        if (!current) return json(404, { error: 'Complaint not found.' })
        if (current.student_id !== user.id) return json(403, { error: 'Feedback is limited to the reporting student.' })
        if (!['Resolved', 'Closed'].includes(current.status)) return json(409, { error: 'Feedback is available after resolution.' })
        await sql`
          insert into feedback (complaint_id, student_id, rating, comment)
          values (${current.id}, ${user.id}, ${parsed.data.rating}, ${parsed.data.comment || null})
          on conflict (complaint_id) do update set rating = excluded.rating, comment = excluded.comment
        `
        await sql`
          insert into audit_logs (actor_id, action, entity_type, entity_id, details)
          values (${user.id}, 'submit_feedback', 'complaint', ${current.id}, ${JSON.stringify({ rating: parsed.data.rating })}::jsonb)
        `
        return json(200, { ok: true })
    }

    if (pathname.startsWith('/complaints/') && method === 'PATCH') {
      if (!requireRole(user, ['superAdmin', 'departmentAdmin', 'safeguardingOfficer'])) {
        return json(403, { error: 'Not authorised to update complaints.' })
      }
      const id = decodeURIComponent(pathname.split('/')[2])
      const body = await getBody(request)
      const allowedStatuses = ['Submitted', 'AI Processing', 'Pending Review', 'Assigned', 'Under Investigation', 'In Progress', 'Resolved', 'Reopened', 'Closed']
      if (!body || typeof body.status !== 'string' || !allowedStatuses.includes(body.status)) {
        return json(400, { error: 'Invalid status.' })
      }
      if (typeof body.officialResponse !== 'undefined' && typeof body.officialResponse !== 'string') {
        return json(400, { error: 'Invalid official response.' })
      }
      if (typeof body.assignedTo !== 'undefined' && typeof body.assignedTo !== 'string') {
        return json(400, { error: 'Invalid assignee.' })
      }
      if (body.assignedTo) {
        const assignee = await sql`
          select id, role, department_id
          from users
          where id = ${body.assignedTo} and account_status = 'active'
          limit 1
        `
        if (!assignee[0]) return json(400, { error: 'Assigned user does not exist or is inactive.' })
        if (assignee[0].role !== 'departmentAdmin' && assignee[0].role !== 'superAdmin') {
          return json(400, { error: 'Complaints may only be assigned to administrators.' })
        }
        if (assignee[0].role === 'departmentAdmin' && assignee[0].department_id !== user.department_id
          && user.role !== 'superAdmin') {
          return json(403, { error: 'Cannot assign to another department.' })
        }
      }
      if (typeof body.internalNote !== 'undefined' && typeof body.internalNote !== 'string') {
        return json(400, { error: 'Invalid internal note.' })
      }

      const result = await sql.begin(async (tx) => {
        const currentRows = await tx`
          select c.* from complaints c where c.id = ${id} or c.public_id = ${id} limit 1
        `
        const current = currentRows[0]
        if (!current) throw new Error('NOT_FOUND')
        if (user.role === 'departmentAdmin' && (current.suggested_department_id !== user.department_id || current.is_safety_restricted)) {
          throw new Error('FORBIDDEN')
        }
        if (user.role === 'safeguardingOfficer' && !current.is_safety_restricted) {
          throw new Error('FORBIDDEN')
        }
        const resolvedAt = body.status === 'Resolved' || body.status === 'Closed' ? 'now()' : null
        const rows = resolvedAt
          ? await tx`
              update complaints set status = ${body.status},
                official_response = coalesce(${body.officialResponse}, official_response),
                assigned_to = coalesce(${body.assignedTo || null}, assigned_to),
                resolved_at = now(), updated_at = now()
              where id = ${current.id} returning *
            `
          : await tx`
              update complaints set status = ${body.status},
                official_response = coalesce(${body.officialResponse}, official_response),
                assigned_to = coalesce(${body.assignedTo || null}, assigned_to),
                resolved_at = null, updated_at = now()
              where id = ${current.id} returning *
            `
        await tx`
          insert into status_history (complaint_id, from_status, to_status, actor_id, note)
          values (${current.id}, ${current.status}, ${body.status}, ${user.id}, ${body.internalNote || body.note || ''})
        `
        await tx`
          insert into management_actions (complaint_id, actor_id, action, details)
          values (${current.id}, ${user.id}, 'status_change',
            ${JSON.stringify({ status: body.status, officialResponse: body.officialResponse || '' })}::jsonb)
        `
        if (body.officialResponse) {
          await tx`
            insert into notifications (recipient_id, title, text, complaint_id)
            values (${current.student_id}, 'Complaint updated', ${body.officialResponse.slice(0, 500)}, ${current.id})
          `
        }
        await tx`
          insert into audit_logs (actor_id, action, entity_type, entity_id, details)
          values (${user.id}, 'update_complaint_status', 'complaint', ${current.id},
            ${JSON.stringify({ status: body.status })}::jsonb)
        `
        if (body.internalNote) {
          await tx`
            insert into internal_notes (complaint_id, actor_id, note, restricted)
            values (${current.id}, ${user.id}, ${body.internalNote}, ${current.is_safety_restricted})
          `
        }
        return rows[0]
      }).catch((error) => {
        if (error.message === 'NOT_FOUND') throw Object.assign(new Error('Complaint not found.'), { status: 404 })
        if (error.message === 'FORBIDDEN') throw Object.assign(new Error('Department or safeguarding restriction.'), { status: 403 })
        throw error
      })
      return json(200, { complaint: result })
    }

    if (pathname === '/analytics' && method === 'GET') {
      if (!requireRole(user, ['superAdmin', 'managementViewer', 'departmentAdmin', 'safeguardingOfficer'])) {
        return json(403, { error: 'Not authorised to view analytics.' })
      }
      let rows
      if (user.role === 'departmentAdmin') {
        rows = await sql`
          select c.*, coalesce(ca.category, c.category, c.selected_category) as category,
            coalesce(ca.priority, c.priority, 'MEDIUM') as priority, d.name as department
          from complaints c left join complaint_analyses ca on ca.complaint_id = c.id
          left join departments d on d.id = c.suggested_department_id
          where c.suggested_department_id = ${user.department_id} and c.is_safety_restricted = false
        `
      } else if (user.role === 'managementViewer') {
        rows = await sql`
          select c.*, coalesce(ca.category, c.category, c.selected_category) as category,
            coalesce(ca.priority, c.priority, 'MEDIUM') as priority, d.name as department
          from complaints c left join complaint_analyses ca on ca.complaint_id = c.id
          left join departments d on d.id = c.suggested_department_id
          where c.is_safety_restricted = false
        `
      } else if (user.role === 'safeguardingOfficer') {
        rows = await sql`
          select c.*, coalesce(ca.category, c.category, c.selected_category) as category,
            coalesce(ca.priority, c.priority, 'MEDIUM') as priority, d.name as department
          from complaints c left join complaint_analyses ca on ca.complaint_id = c.id
          left join departments d on d.id = c.suggested_department_id
          where c.is_safety_restricted = true
        `
      } else {
        rows = await sql`
          select c.*, coalesce(ca.category, c.category, c.selected_category) as category,
            coalesce(ca.priority, c.priority, 'MEDIUM') as priority, d.name as department
          from complaints c
          left join complaint_analyses ca on ca.complaint_id = c.id
          left join departments d on d.id = c.suggested_department_id
        `
      }
      return json(200, {
        analytics: aggregateComplaintRecords(rows),
      })
    }

    if (pathname === '/notifications' && method === 'GET') {
      const rows = await sql`
        select * from notifications where recipient_id = ${user.id} order by created_at desc limit 100
      `
      return json(200, { notifications: rows })
    }

    if (pathname === '/issue-groups' && method === 'GET') {
      if (!requireRole(user, ['superAdmin', 'managementViewer', 'departmentAdmin', 'safeguardingOfficer'])) {
        return json(403, { error: 'Not authorised to view issue groups.' })
      }
      let rows
      if (user.role === 'departmentAdmin') {
        rows = await sql`
          select ig.*, d.name as department,
            count(distinct c.student_id)::int as complaint_count,
            count(distinct c.student_id)::int as distinct_students,
            count(igm.complaint_id)::int as member_count,
            coalesce((array_agg(ca.priority order by case ca.priority when 'CRITICAL' then 4 when 'HIGH' then 3 when 'MEDIUM' then 2 when 'LOW' then 1 else 0 end desc))[1], 'MEDIUM') as priority,
            coalesce((array_agg(ca.urgency order by case ca.urgency when 'IMMEDIATE' then 4 when 'URGENT' then 3 when 'NORMAL' then 2 when 'LOW' then 1 else 0 end desc))[1], 'NORMAL') as urgency,
            jsonb_agg(jsonb_build_object('id', c.public_id, 'status', c.status, 'safetyFlags', coalesce(ca.safety_flags, '[]'::jsonb)) order by c.created_at desc) as complaints,
            min(c.created_at) as first_reported,
            max(c.created_at) as latest_reported
          from issue_groups ig
          join departments d on d.id = ig.department_id
          join issue_group_members igm on igm.issue_group_id = ig.id
          join complaints c on c.id = igm.complaint_id
          left join complaint_analyses ca on ca.complaint_id = c.id
          where ig.department_id = ${user.department_id}
            and ig.is_safety_restricted = false and c.is_safety_restricted = false
          group by ig.id, d.name
          order by ig.latest_reported desc limit 500
        `
      } else if (user.role === 'managementViewer') {
        rows = await sql`
          select ig.*, d.name as department,
            count(distinct c.student_id)::int as complaint_count,
            count(distinct c.student_id)::int as distinct_students,
            count(igm.complaint_id)::int as member_count,
            coalesce((array_agg(ca.priority order by case ca.priority when 'CRITICAL' then 4 when 'HIGH' then 3 when 'MEDIUM' then 2 when 'LOW' then 1 else 0 end desc))[1], 'MEDIUM') as priority,
            coalesce((array_agg(ca.urgency order by case ca.urgency when 'IMMEDIATE' then 4 when 'URGENT' then 3 when 'NORMAL' then 2 when 'LOW' then 1 else 0 end desc))[1], 'NORMAL') as urgency,
            jsonb_agg(jsonb_build_object('id', c.public_id, 'status', c.status, 'safetyFlags', coalesce(ca.safety_flags, '[]'::jsonb)) order by c.created_at desc) as complaints,
            min(c.created_at) as first_reported,
            max(c.created_at) as latest_reported
          from issue_groups ig
          join departments d on d.id = ig.department_id
          join issue_group_members igm on igm.issue_group_id = ig.id
          join complaints c on c.id = igm.complaint_id
          left join complaint_analyses ca on ca.complaint_id = c.id
          where ig.is_safety_restricted = false and c.is_safety_restricted = false
          group by ig.id, d.name
          order by ig.latest_reported desc limit 500
        `
      } else if (user.role === 'safeguardingOfficer') {
        rows = await sql`
          select ig.*, d.name as department,
            count(distinct c.student_id)::int as complaint_count,
            count(distinct c.student_id)::int as distinct_students,
            count(igm.complaint_id)::int as member_count,
            coalesce((array_agg(ca.priority order by case ca.priority when 'CRITICAL' then 4 when 'HIGH' then 3 when 'MEDIUM' then 2 when 'LOW' then 1 else 0 end desc))[1], 'MEDIUM') as priority,
            coalesce((array_agg(ca.urgency order by case ca.urgency when 'IMMEDIATE' then 4 when 'URGENT' then 3 when 'NORMAL' then 2 when 'LOW' then 1 else 0 end desc))[1], 'NORMAL') as urgency,
            jsonb_agg(jsonb_build_object('id', c.public_id, 'status', c.status, 'safetyFlags', coalesce(ca.safety_flags, '[]'::jsonb)) order by c.created_at desc) as complaints,
            min(c.created_at) as first_reported,
            max(c.created_at) as latest_reported
          from issue_groups ig
          join departments d on d.id = ig.department_id
          join issue_group_members igm on igm.issue_group_id = ig.id
          join complaints c on c.id = igm.complaint_id
          left join complaint_analyses ca on ca.complaint_id = c.id
          where ig.is_safety_restricted = true and c.is_safety_restricted = true
          group by ig.id, d.name
          order by ig.latest_reported desc limit 500
        `
      } else {
        rows = await sql`
          select ig.*, d.name as department,
            count(distinct c.student_id)::int as complaint_count,
            count(distinct c.student_id)::int as distinct_students,
            count(igm.complaint_id)::int as member_count,
            coalesce((array_agg(ca.priority order by case ca.priority when 'CRITICAL' then 4 when 'HIGH' then 3 when 'MEDIUM' then 2 when 'LOW' then 1 else 0 end desc))[1], 'MEDIUM') as priority,
            coalesce((array_agg(ca.urgency order by case ca.urgency when 'IMMEDIATE' then 4 when 'URGENT' then 3 when 'NORMAL' then 2 when 'LOW' then 1 else 0 end desc))[1], 'NORMAL') as urgency,
            jsonb_agg(jsonb_build_object('id', c.public_id, 'status', c.status, 'safetyFlags', coalesce(ca.safety_flags, '[]'::jsonb)) order by c.created_at desc) as complaints,
            min(c.created_at) as first_reported,
            max(c.created_at) as latest_reported
          from issue_groups ig
          join departments d on d.id = ig.department_id
          join issue_group_members igm on igm.issue_group_id = ig.id
          join complaints c on c.id = igm.complaint_id
          left join complaint_analyses ca on ca.complaint_id = c.id
          group by ig.id, d.name
          order by ig.latest_reported desc limit 500
        `
      }
      return json(200, { groups: rows })
    }

    if (pathname === '/reports' && method === 'POST') {
      if (!requireRole(user, ['superAdmin', 'managementViewer', 'departmentAdmin', 'safeguardingOfficer'])) {
        return json(403, { error: 'Not authorised to generate reports.' })
      }
      const body = await getBody(request)
      const reportSchema = z.object({
        periodType: z.enum(['week', 'month', 'quarter', 'custom']),
        startAt: z.string().optional(),
        endAt: z.string().optional(),
      })
      const parsed = reportSchema.safeParse(body)
      if (!parsed.success) return json(400, { error: 'Invalid report period.' })
      const now = new Date()
      let startAt
      let endAt = new Date(now)
      if (parsed.data.periodType === 'week') {
        startAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
        startAt.setUTCDate(startAt.getUTCDate() - ((startAt.getUTCDay() + 6) % 7))
      } else if (parsed.data.periodType === 'month') {
        startAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      } else if (parsed.data.periodType === 'quarter') {
        startAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1))
      } else {
        const startValue = parsed.data.startAt || ''
        const endValue = parsed.data.endAt || ''
        startAt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(startValue) ? `${startValue}T00:00:00.000Z` : startValue)
        endAt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(endValue) ? `${endValue}T23:59:59.999Z` : endValue)
        const hasInvalidCalendarDate = [startValue, endValue].some((value) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
          const date = new Date(`${value}T00:00:00.000Z`)
          return !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value
        })
        if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || startAt > endAt || hasInvalidCalendarDate) {
          return json(400, { error: 'Invalid custom report range.' })
        }
      }
      const reportRows = user.role === 'departmentAdmin'
        ? await sql`
            select c.student_id, c.status, c.is_safety_restricted, c.created_at,
              coalesce(ca.category, c.category, c.selected_category) as category,
              coalesce(d.name, 'General Administration') as department,
              coalesce(ca.priority, c.priority, 'MEDIUM') as priority
            from complaints c
            left join complaint_analyses ca on ca.complaint_id = c.id
            left join departments d on d.id = c.suggested_department_id
            where c.suggested_department_id = ${user.department_id}
              and c.is_safety_restricted = false
              and c.created_at >= ${startAt.toISOString()}
              and c.created_at <= ${endAt.toISOString()}
          `
        : user.role === 'managementViewer'
          ? await sql`
              select c.student_id, c.status, c.is_safety_restricted, c.created_at,
                coalesce(ca.category, c.category, c.selected_category) as category,
                coalesce(d.name, 'General Administration') as department,
                coalesce(ca.priority, c.priority, 'MEDIUM') as priority
              from complaints c
              left join complaint_analyses ca on ca.complaint_id = c.id
              left join departments d on d.id = c.suggested_department_id
              where c.is_safety_restricted = false
                and c.created_at >= ${startAt.toISOString()}
                and c.created_at <= ${endAt.toISOString()}
            `
          : user.role === 'safeguardingOfficer'
            ? await sql`
                select c.student_id, c.status, c.is_safety_restricted, c.created_at,
                  coalesce(ca.category, c.category, c.selected_category) as category,
                  coalesce(d.name, 'General Administration') as department,
                  coalesce(ca.priority, c.priority, 'MEDIUM') as priority
                from complaints c
                left join complaint_analyses ca on ca.complaint_id = c.id
                left join departments d on d.id = c.suggested_department_id
                where c.is_safety_restricted = true
                  and c.created_at >= ${startAt.toISOString()}
                  and c.created_at <= ${endAt.toISOString()}
              `
            : await sql`
                select c.student_id, c.status, c.is_safety_restricted, c.created_at,
                  coalesce(ca.category, c.category, c.selected_category) as category,
                  coalesce(d.name, 'General Administration') as department,
                  coalesce(ca.priority, c.priority, 'MEDIUM') as priority
                from complaints c
                left join complaint_analyses ca on ca.complaint_id = c.id
                left join departments d on d.id = c.suggested_department_id
                where c.created_at >= ${startAt.toISOString()}
                  and c.created_at <= ${endAt.toISOString()}
              `
      const issueGroups = await sql`
        select count(distinct ig.id)::int as count
        from issue_groups ig
        join issue_group_members igm on igm.issue_group_id = ig.id
        join complaints c on c.id = igm.complaint_id
        where c.created_at >= ${startAt.toISOString()}
          and c.created_at <= ${endAt.toISOString()}
          and (${user.role === 'superAdmin'} or ig.is_safety_restricted = ${user.role === 'safeguardingOfficer'})
          and (${user.role !== 'departmentAdmin'} or ig.department_id = ${user.department_id})
      `
      const report = {
        periodType: parsed.data.periodType,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        ...aggregateComplaintRecords(reportRows, { groupCount: issueGroups[0]?.count || 0 }),
      }
      let aiSummary = null
      let aiSummaryStatus = 'unavailable'
      try {
        aiSummary = await callGeminiReportSummary(report)
        aiSummaryStatus = 'generated'
        await sql`
          insert into ai_requests (request_type, model_name, status)
          values ('management_summary', ${process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'}, 'success')
        `
      } catch (summaryError) {
        try {
          await sql`
            insert into ai_requests (request_type, model_name, status, error_code)
            values (
              'management_summary',
              ${process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'},
              'failed',
              ${String(summaryError?.status || summaryError?.name || 'unknown').slice(0, 120)}
            )
          `
        } catch (logError) {
          console.error('AI report telemetry could not be recorded:', logError?.name || 'Error')
        }
      }
      report.aiSummary = aiSummary
      report.aiSummaryStatus = aiSummaryStatus
      await sql`
        insert into management_reports (generated_by, period_type, start_at, end_at, report, executive_summary)
        values (
          ${user.id}, ${parsed.data.periodType}, ${startAt.toISOString()}, ${endAt.toISOString()},
          ${JSON.stringify(report)}::jsonb, ${aiSummary?.summary || null}
        )
      `
      return json(200, { report })
    }

    return json(404, { error: 'API route not found.' })
  } catch (error) {
    if (error.status) return json(error.status, { error: error.message })
    if (error instanceof z.ZodError) return json(400, { error: 'Request validation failed.' })
    console.error('CampusVoice API error:', error?.name || 'Error')
    return json(500, { error: 'The request could not be completed.' })
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {})
  }
}

export default async function handler(request) {
  const response = await handleRequest(request)
  return applySessionRefresh(request, response)
}
