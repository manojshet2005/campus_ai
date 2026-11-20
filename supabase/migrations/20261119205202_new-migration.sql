CREATE SCHEMA IF NOT EXISTS extensions;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'vector' AND n.nspname <> 'extensions'
  ) THEN
    ALTER EXTENSION vector SET SCHEMA extensions;
  ELSIF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE EXTENSION vector WITH SCHEMA extensions;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('student','superAdmin','managementViewer','departmentAdmin','safeguardingOfficer')),
  student_id TEXT,
  legacy_password_hash TEXT,
  department_id UUID REFERENCES public.departments(id),
  account_status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS legacy_password_hash TEXT;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'password_hash'
  ) THEN
    UPDATE public.users SET legacy_password_hash = password_hash
    WHERE legacy_password_hash IS NULL;
    ALTER TABLE public.users DROP COLUMN password_hash;
  END IF;
END
$$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_user_id ON public.users(auth_user_id);

CREATE TABLE IF NOT EXISTS public.complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id TEXT NOT NULL UNIQUE,
  student_id UUID NOT NULL REFERENCES public.users(id),
  original_complaint TEXT NOT NULL,
  selected_category TEXT NOT NULL,
  selected_subcategory TEXT NOT NULL,
  custom_category TEXT,
  category TEXT,
  subcategory TEXT,
  suggested_department_id UUID REFERENCES public.departments(id),
  priority TEXT CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  urgency TEXT CHECK (urgency IN ('LOW','NORMAL','URGENT','IMMEDIATE')),
  sentiment TEXT,
  status TEXT NOT NULL DEFAULT 'Submitted',
  is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  is_safety_restricted BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_to UUID REFERENCES public.users(id),
  official_response TEXT NOT NULL DEFAULT '',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.complaint_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL UNIQUE REFERENCES public.complaints(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS public.complaint_embeddings (
  complaint_id UUID PRIMARY KEY REFERENCES public.complaints(id) ON DELETE CASCADE,
  embedding extensions.vector(768) NOT NULL,
  model_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.issue_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  department_id UUID REFERENCES public.departments(id),
  is_safety_restricted BOOLEAN NOT NULL DEFAULT FALSE,
  representative_complaint_id UUID REFERENCES public.complaints(id),
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'Open',
  first_reported TIMESTAMPTZ,
  latest_reported TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.issue_groups
  ADD COLUMN IF NOT EXISTS is_safety_restricted BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE public.issue_groups AS ig
SET is_safety_restricted = c.is_safety_restricted
FROM public.complaints AS c
WHERE ig.representative_complaint_id = c.id
  AND c.is_safety_restricted = TRUE
  AND ig.is_safety_restricted = FALSE;

CREATE TABLE IF NOT EXISTS public.issue_group_members (
  issue_group_id UUID NOT NULL REFERENCES public.issue_groups(id) ON DELETE CASCADE,
  complaint_id UUID NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  similarity_score DOUBLE PRECISION,
  PRIMARY KEY (issue_group_id, complaint_id)
);

CREATE TABLE IF NOT EXISTS public.status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id UUID REFERENCES public.users(id),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  complaint_id UUID REFERENCES public.complaints(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.safeguarding_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL UNIQUE REFERENCES public.complaints(id) ON DELETE CASCADE,
  assigned_officer_id UUID REFERENCES public.users(id),
  escalated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'Open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.internal_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES public.users(id),
  note TEXT NOT NULL,
  restricted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.management_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_by UUID NOT NULL REFERENCES public.users(id),
  period_type TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  report JSONB NOT NULL,
  executive_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.management_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES public.users(id),
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL UNIQUE REFERENCES public.complaints(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type TEXT NOT NULL,
  model_name TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt_tokens INTEGER,
  response_tokens INTEGER,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.app_schema_migrations (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_complaints_student ON public.complaints(student_id);
CREATE INDEX IF NOT EXISTS idx_complaints_department ON public.complaints(suggested_department_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON public.complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_created ON public.complaints(created_at);
CREATE INDEX IF NOT EXISTS idx_complaints_safety ON public.complaints(is_safety_restricted);
CREATE INDEX IF NOT EXISTS idx_complaints_vector_cosine
  ON public.complaint_embeddings USING hnsw (embedding extensions.vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_issue_group_members_complaint ON public.issue_group_members(complaint_id);
CREATE INDEX IF NOT EXISTS idx_status_history_complaint ON public.status_history(complaint_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_safeguarding_status ON public.safeguarding_cases(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at);

INSERT INTO public.departments (name) VALUES
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

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.role
  FROM public.users AS u
  WHERE u.auth_user_id = auth.uid() AND u.account_status = 'active'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_app_department()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.department_id
  FROM public.users AS u
  WHERE u.auth_user_id = auth.uid() AND u.account_status = 'active'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.can_access_complaint(target_complaint_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.complaints AS c
    JOIN public.users AS u ON u.auth_user_id = auth.uid() AND u.account_status = 'active'
    WHERE c.id = target_complaint_id
      AND (
        (u.role = 'student' AND c.student_id = u.id)
        OR u.role = 'superAdmin'
        OR (u.role = 'managementViewer' AND c.is_safety_restricted = FALSE)
        OR (u.role = 'departmentAdmin' AND c.suggested_department_id = u.department_id AND c.is_safety_restricted = FALSE)
        OR (u.role = 'safeguardingOfficer' AND c.is_safety_restricted = TRUE)
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  selected_department_id UUID;
BEGIN
  SELECT d.id INTO selected_department_id
  FROM public.departments AS d
  WHERE lower(d.name) = lower(coalesce(new.raw_user_meta_data ->> 'department', 'General Administration'))
  LIMIT 1;

  INSERT INTO public.users (auth_user_id, name, email, role, student_id, department_id)
  VALUES (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), 'Student'),
    lower(new.email),
    'student',
    new.raw_user_meta_data ->> 'student_id',
    selected_department_id
  )
  ON CONFLICT (email) DO UPDATE
  SET auth_user_id = excluded.auth_user_id,
      name = excluded.name,
      student_id = excluded.student_id,
      department_id = excluded.department_id,
      updated_at = now()
  WHERE public.users.auth_user_id IS NULL AND public.users.role = 'student';

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_app_department() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_complaint(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_department() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_complaint(UUID) TO authenticated;

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issue_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issue_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safeguarding_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.management_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.management_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_schema_migrations ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF to_regclass('public.sessions') IS NOT NULL THEN
    ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
  END IF;
END
$$;

DROP POLICY IF EXISTS departments_read_active ON public.departments;
CREATE POLICY departments_read_active ON public.departments
  FOR SELECT TO anon, authenticated USING (active = TRUE);

DROP POLICY IF EXISTS users_read_scoped ON public.users;
CREATE POLICY users_read_scoped ON public.users
  FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR public.current_app_role() = 'superAdmin'
    OR (public.current_app_role() = 'departmentAdmin' AND department_id = public.current_app_department())
  );

DROP POLICY IF EXISTS users_update_student_profile ON public.users;
REVOKE UPDATE ON public.users FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS complaints_read_scoped ON public.complaints;
CREATE POLICY complaints_read_scoped ON public.complaints
  FOR SELECT TO authenticated USING (public.can_access_complaint(id));

DROP POLICY IF EXISTS complaints_update_scoped ON public.complaints;
CREATE POLICY complaints_update_scoped ON public.complaints
  FOR UPDATE TO authenticated USING (
    public.current_app_role() = 'superAdmin'
    OR (public.current_app_role() = 'departmentAdmin'
      AND suggested_department_id = public.current_app_department()
      AND is_safety_restricted = FALSE)
    OR (public.current_app_role() = 'safeguardingOfficer' AND is_safety_restricted = TRUE)
  )
  WITH CHECK (public.can_access_complaint(id));

DROP POLICY IF EXISTS complaint_analyses_read_scoped ON public.complaint_analyses;
CREATE POLICY complaint_analyses_read_scoped ON public.complaint_analyses
  FOR SELECT TO authenticated USING (public.can_access_complaint(complaint_id));

DROP POLICY IF EXISTS complaint_embeddings_read_scoped ON public.complaint_embeddings;
CREATE POLICY complaint_embeddings_read_scoped ON public.complaint_embeddings
  FOR SELECT TO authenticated USING (public.can_access_complaint(complaint_id));

DROP POLICY IF EXISTS issue_groups_read_scoped ON public.issue_groups;
CREATE POLICY issue_groups_read_scoped ON public.issue_groups
  FOR SELECT TO authenticated USING (
    (
      public.current_app_role() = 'superAdmin'
      OR (public.current_app_role() = 'managementViewer' AND is_safety_restricted = FALSE)
      OR (public.current_app_role() = 'departmentAdmin'
        AND department_id = public.current_app_department()
        AND is_safety_restricted = FALSE)
      OR (public.current_app_role() = 'safeguardingOfficer' AND is_safety_restricted = TRUE)
    )
    AND
    EXISTS (
      SELECT 1 FROM public.issue_group_members AS m
      WHERE m.issue_group_id = id AND public.can_access_complaint(m.complaint_id)
    )
  );

DROP POLICY IF EXISTS issue_group_members_read_scoped ON public.issue_group_members;
CREATE POLICY issue_group_members_read_scoped ON public.issue_group_members
  FOR SELECT TO authenticated USING (public.can_access_complaint(complaint_id));

DROP POLICY IF EXISTS status_history_read_scoped ON public.status_history;
CREATE POLICY status_history_read_scoped ON public.status_history
  FOR SELECT TO authenticated USING (public.can_access_complaint(complaint_id));

DROP POLICY IF EXISTS notifications_read_own ON public.notifications;
CREATE POLICY notifications_read_own ON public.notifications
  FOR SELECT TO authenticated USING (
    recipient_id = (SELECT u.id FROM public.users AS u WHERE u.auth_user_id = auth.uid())
  );
DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE TO authenticated USING (
    recipient_id = (SELECT u.id FROM public.users AS u WHERE u.auth_user_id = auth.uid())
  )
  WITH CHECK (
    recipient_id = (SELECT u.id FROM public.users AS u WHERE u.auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS safeguarding_cases_read_authorized ON public.safeguarding_cases;
CREATE POLICY safeguarding_cases_read_authorized ON public.safeguarding_cases
  FOR SELECT TO authenticated USING (
    public.current_app_role() IN ('superAdmin', 'safeguardingOfficer')
  );

DROP POLICY IF EXISTS internal_notes_read_authorized ON public.internal_notes;
CREATE POLICY internal_notes_read_authorized ON public.internal_notes
  FOR SELECT TO authenticated USING (
    public.can_access_complaint(complaint_id)
    AND public.current_app_role() <> 'student'
    AND (restricted = FALSE OR public.current_app_role() IN ('superAdmin', 'safeguardingOfficer'))
  );

DROP POLICY IF EXISTS management_reports_read_authorized ON public.management_reports;
CREATE POLICY management_reports_read_authorized ON public.management_reports
  FOR SELECT TO authenticated USING (
    public.current_app_role() = 'superAdmin'
    OR generated_by = (
      SELECT u.id FROM public.users AS u WHERE u.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS management_actions_read_scoped ON public.management_actions;
CREATE POLICY management_actions_read_scoped ON public.management_actions
  FOR SELECT TO authenticated USING (public.can_access_complaint(complaint_id));

DROP POLICY IF EXISTS feedback_read_scoped ON public.feedback;
CREATE POLICY feedback_read_scoped ON public.feedback
  FOR SELECT TO authenticated USING (
    student_id = (SELECT u.id FROM public.users AS u WHERE u.auth_user_id = auth.uid())
    OR public.can_access_complaint(complaint_id)
  );
DROP POLICY IF EXISTS feedback_insert_own_resolved ON public.feedback;
CREATE POLICY feedback_insert_own_resolved ON public.feedback
  FOR INSERT TO authenticated WITH CHECK (
    student_id = (SELECT u.id FROM public.users AS u WHERE u.auth_user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.complaints AS c
      WHERE c.id = public.feedback.complaint_id
        AND c.student_id = public.feedback.student_id
        AND c.status IN ('Resolved', 'Closed')
    )
  );

DROP POLICY IF EXISTS audit_logs_read_super_admin ON public.audit_logs;
CREATE POLICY audit_logs_read_super_admin ON public.audit_logs
  FOR SELECT TO authenticated USING (public.current_app_role() = 'superAdmin');

DROP POLICY IF EXISTS ai_requests_read_super_admin ON public.ai_requests;
CREATE POLICY ai_requests_read_super_admin ON public.ai_requests
  FOR SELECT TO authenticated USING (public.current_app_role() = 'superAdmin');

GRANT USAGE ON SCHEMA public TO anon, authenticated;
REVOKE ALL ON public.departments, public.users, public.complaints,
  public.complaint_analyses, public.complaint_embeddings, public.issue_groups,
  public.issue_group_members, public.status_history, public.notifications,
  public.safeguarding_cases, public.internal_notes, public.management_reports,
  public.management_actions, public.feedback, public.audit_logs, public.ai_requests,
  public.app_schema_migrations
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.departments TO anon, authenticated;
REVOKE ALL ON public.users FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, name, role, student_id, department_id,
  account_status, created_at, updated_at
) ON public.users TO authenticated;
GRANT SELECT ON public.complaints, public.complaint_analyses,
  public.complaint_embeddings, public.issue_groups, public.issue_group_members,
  public.status_history, public.notifications, public.safeguarding_cases,
  public.internal_notes, public.management_reports, public.management_actions,
  public.feedback, public.audit_logs, public.ai_requests TO authenticated;
