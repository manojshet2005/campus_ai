import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'

const authSchema = pgSchema('auth')
const authUsers = authSchema.table('users', {
  id: uuid('id').primaryKey(),
})

export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  authUserId: uuid('auth_user_id').references(() => authUsers.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  role: text('role').notNull(),
  studentId: text('student_id'),
  legacyPasswordHash: text('legacy_password_hash'),
  departmentId: uuid('department_id').references(() => departments.id),
  accountStatus: text('account_status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idx_users_auth_user_id').on(table.authUserId),
])

export const complaints = pgTable('complaints', {
  id: uuid('id').primaryKey().defaultRandom(),
  publicId: text('public_id').notNull().unique(),
  studentId: uuid('student_id').notNull().references(() => users.id),
  originalComplaint: text('original_complaint').notNull(),
  selectedCategory: text('selected_category').notNull(),
  selectedSubcategory: text('selected_subcategory').notNull(),
  customCategory: text('custom_category'),
  category: text('category'),
  subcategory: text('subcategory'),
  suggestedDepartmentId: uuid('suggested_department_id').references(() => departments.id),
  priority: text('priority'),
  urgency: text('urgency'),
  sentiment: text('sentiment'),
  status: text('status').notNull().default('Submitted'),
  isAnonymous: boolean('is_anonymous').notNull().default(false),
  isSafetyRestricted: boolean('is_safety_restricted').notNull().default(false),
  assignedTo: uuid('assigned_to').references(() => users.id),
  officialResponse: text('official_response').notNull().default(''),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_complaints_student').on(table.studentId),
  index('idx_complaints_department').on(table.suggestedDepartmentId),
  index('idx_complaints_status').on(table.status),
  index('idx_complaints_created').on(table.createdAt),
  index('idx_complaints_safety').on(table.isSafetyRestricted),
])

export const complaintAnalyses = pgTable('complaint_analyses', {
  id: uuid('id').primaryKey().defaultRandom(),
  complaintId: uuid('complaint_id').notNull().unique().references(() => complaints.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull(),
  category: text('category').notNull(),
  subcategory: text('subcategory').notNull(),
  suggestedDepartment: text('suggested_department'),
  priority: text('priority').notNull(),
  urgency: text('urgency').notNull(),
  sentiment: text('sentiment').notNull(),
  issueType: text('issue_type'),
  keywords: jsonb('keywords').notNull().default([]),
  safetyFlags: jsonb('safety_flags').notNull().default([]),
  requiresHumanReview: boolean('requires_human_review').notNull().default(false),
  explanation: text('explanation'),
  recommendation: text('recommendation'),
  modelName: text('model_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const complaintEmbeddings = pgTable('complaint_embeddings', {
  complaintId: uuid('complaint_id').primaryKey().references(() => complaints.id, { onDelete: 'cascade' }),
  embedding: vector('embedding', { dimensions: 768 }).notNull(),
  modelName: text('model_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const issueGroups = pgTable('issue_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  departmentId: uuid('department_id').references(() => departments.id),
  isSafetyRestricted: boolean('is_safety_restricted').notNull().default(false),
  representativeComplaintId: uuid('representative_complaint_id').references(() => complaints.id),
  summary: text('summary'),
  status: text('status').notNull().default('Open'),
  firstReported: timestamp('first_reported', { withTimezone: true }),
  latestReported: timestamp('latest_reported', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const issueGroupMembers = pgTable('issue_group_members', {
  issueGroupId: uuid('issue_group_id').notNull().references(() => issueGroups.id, { onDelete: 'cascade' }),
  complaintId: uuid('complaint_id').notNull().references(() => complaints.id, { onDelete: 'cascade' }),
  similarityScore: doublePrecision('similarity_score'),
}, (table) => [
  primaryKey({ columns: [table.issueGroupId, table.complaintId] }),
  index('idx_issue_group_members_complaint').on(table.complaintId),
])

export const statusHistory = pgTable('status_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  complaintId: uuid('complaint_id').notNull().references(() => complaints.id, { onDelete: 'cascade' }),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  actorId: uuid('actor_id').references(() => users.id),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_status_history_complaint').on(table.complaintId),
])

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipientId: uuid('recipient_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  text: text('text').notNull(),
  complaintId: uuid('complaint_id').references(() => complaints.id, { onDelete: 'cascade' }),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_notifications_recipient').on(table.recipientId),
])

export const safeguardingCases = pgTable('safeguarding_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  complaintId: uuid('complaint_id').notNull().unique().references(() => complaints.id, { onDelete: 'cascade' }),
  assignedOfficerId: uuid('assigned_officer_id').references(() => users.id),
  escalatedAt: timestamp('escalated_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').notNull().default('Open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_safeguarding_status').on(table.status),
])

export const internalNotes = pgTable('internal_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  complaintId: uuid('complaint_id').notNull().references(() => complaints.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').notNull().references(() => users.id),
  note: text('note').notNull(),
  restricted: boolean('restricted').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const managementReports = pgTable('management_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  generatedBy: uuid('generated_by').notNull().references(() => users.id),
  periodType: text('period_type').notNull(),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  report: jsonb('report').notNull(),
  executiveSummary: text('executive_summary'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const managementActions = pgTable('management_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  complaintId: uuid('complaint_id').notNull().references(() => complaints.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').notNull().references(() => users.id),
  action: text('action').notNull(),
  details: jsonb('details').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const feedback = pgTable('feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  complaintId: uuid('complaint_id').notNull().unique().references(() => complaints.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id').notNull().references(() => users.id),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id').references(() => users.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  details: jsonb('details').notNull().default({}),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_audit_logs_created').on(table.createdAt),
])

export const aiRequests = pgTable('ai_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestType: text('request_type').notNull(),
  modelName: text('model_name').notNull(),
  status: text('status').notNull(),
  promptTokens: integer('prompt_tokens'),
  responseTokens: integer('response_tokens'),
  errorCode: text('error_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
