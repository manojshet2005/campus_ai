import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'

export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(),
  studentId: text('student_id'),
  departmentId: uuid('department_id').references(() => departments.id),
  accountStatus: text('account_status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('idx_sessions_user').on(table.userId)])

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
