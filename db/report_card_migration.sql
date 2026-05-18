-- ============================================================
-- Report Card Migration — run ONCE in Supabase SQL Editor
-- Safe: only ADDs new columns/table, never drops existing data
-- ============================================================

-- Add optional financial fields to employees
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS monthly_salary   NUMERIC      DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS paid_leaves_pm   INT          DEFAULT 0,
  ADD COLUMN IF NOT EXISTS joining_date     DATE         DEFAULT NULL;

-- Monthly report snapshots (one row per employee per month)
CREATE TABLE IF NOT EXISTS monthly_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID REFERENCES owners(id)    ON DELETE CASCADE NOT NULL,
  employee_id      UUID REFERENCES employees(id) ON DELETE SET NULL,
  month            DATE    NOT NULL,           -- always first day of month, e.g. 2026-05-01
  employee_name    TEXT    NOT NULL,           -- snapshot name in case employee is deleted
  employee_role    TEXT,
  days_present     INT     DEFAULT 0,
  days_absent      INT     DEFAULT 0,
  days_late        INT     DEFAULT 0,
  early_exits      INT     DEFAULT 0,
  paid_leaves_used INT     DEFAULT 0,
  unpaid_absences  INT     DEFAULT 0,
  base_salary      NUMERIC,
  deductions       NUMERIC DEFAULT 0,
  net_salary       NUMERIC,
  flags            JSONB   DEFAULT '[]',
  generated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, month)
);

ALTER TABLE monthly_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "monthly_reports_all" ON monthly_reports;
CREATE POLICY "monthly_reports_all" ON monthly_reports FOR ALL
  USING  (owner_id = my_owner_id())
  WITH CHECK (owner_id = my_owner_id());
