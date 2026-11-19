CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','superAdmin','managementViewer','departmentAdmin','safeguardingOfficer')),
  student_id TEXT,
  department_id UUID REFERENCES departments(id),
  account_status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id TEXT NOT NULL UNIQUE,
  student_id UUID NOT NULL REFERENCES users(id),
  original_complaint TEXT NOT NULL,
  selected_category TEXT NOT NULL,
  selected_subcategory TEXT NOT NULL,
  custom_category TEXT,
  category TEXT,
  subcategory TEXT,
  suggested_department_id UUID REFERENCES departments(id),
  priority TEXT CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  urgency TEXT CHECK (urgency IN ('LOW','NORMAL','URGENT','IMMEDIATE')),
  sentiment TEXT,
  status TEXT NOT NULL DEFAULT 'Submitted',
  is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  is_safety_restricted BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_to UUID REFERENCES users(id),
  official_response TEXT NOT NULL DEFAULT '',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS complaint_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL UNIQUE REFERENCES complaints(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  suggested_department TEXT,
  priority TEXT NOT NULL,
  urgency TEXT NOT NULL,
  sentiment TEXT NOT NULL,
  issue_type TEXT,
  keywords JSONB NOT NULL DEFAULT '[]'::JSONB,
  safety_flags JSONB NOT NULL DEFAULT '[]'::JSONB,
  requires_human_review BOOLEAN NOT NULL DEFAULT FALSE,
  explanation TEXT,
  recommendation TEXT,
  model_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS complaint_embeddings (
  complaint_id UUID PRIMARY KEY REFERENCES complaints(id) ON DELETE CASCADE,
  embedding vector(768) NOT NULL,
  model_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS issue_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  department_id UUID REFERENCES departments(id),
  representative_complaint_id UUID REFERENCES complaints(id),
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'Open',
  first_reported TIMESTAMPTZ,
  latest_reported TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS issue_group_members (
  issue_group_id UUID NOT NULL REFERENCES issue_groups(id) ON DELETE CASCADE,
  complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  similarity_score DOUBLE PRECISION,
  PRIMARY KEY (issue_group_id, complaint_id)
);

CREATE TABLE IF NOT EXISTS status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id UUID REFERENCES users(id),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  complaint_id UUID REFERENCES complaints(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS safeguarding_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL UNIQUE REFERENCES complaints(id) ON DELETE CASCADE,
  assigned_officer_id UUID REFERENCES users(id),
  escalated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'Open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS internal_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  restricted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS management_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_by UUID NOT NULL REFERENCES users(id),
  period_type TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  report JSONB NOT NULL,
  executive_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS management_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL UNIQUE REFERENCES complaints(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type TEXT NOT NULL,
  model_name TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt_tokens INTEGER,
  response_tokens INTEGER,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_complaints_student ON complaints(student_id);
CREATE INDEX IF NOT EXISTS idx_complaints_department ON complaints(suggested_department_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_created ON complaints(created_at);
CREATE INDEX IF NOT EXISTS idx_complaints_safety ON complaints(is_safety_restricted);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id);
ALTER TABLE complaint_analyses ADD COLUMN IF NOT EXISTS requires_human_review BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE complaint_embeddings ADD COLUMN IF NOT EXISTS model_name TEXT;
CREATE INDEX IF NOT EXISTS idx_issue_group_members_complaint ON issue_group_members(complaint_id);
CREATE INDEX IF NOT EXISTS idx_status_history_complaint ON status_history(complaint_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_safeguarding_status ON safeguarding_cases(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

INSERT INTO departments (name) VALUES
  ('Hostel Administration'),
  ('Academic Administration'),
  ('Examination Department'),
  ('Faculty Administration'),
  ('Canteen Management'),
  ('Infrastructure Department'),
  ('Transport Department'),
  ('Student Welfare'),
  ('Placement Cell'),
  ('General Administration')
ON CONFLICT (name) DO NOTHING;
