-- ============================================================
-- Mark-it Attendance System — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- DROP OLD TABLES (from previous schema with integer PKs)
-- ────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS employee_images  CASCADE;
DROP TABLE IF EXISTS attendance       CASCADE;
DROP TABLE IF EXISTS employees        CASCADE;
DROP TABLE IF EXISTS settings         CASCADE;
DROP TABLE IF EXISTS owners           CASCADE;
DROP TABLE IF EXISTS owner            CASCADE;

-- ────────────────────────────────────────────────────────────
-- TABLES
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS owners (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  email       TEXT NOT NULL,
  org_name    TEXT NOT NULL DEFAULT 'My Organization',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID REFERENCES owners(id) ON DELETE CASCADE NOT NULL,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL DEFAULT 'Employee',
  photo_urls       TEXT[] DEFAULT '{}',
  -- Array of 128-number face descriptor arrays (one per captured photo)
  face_descriptors JSONB DEFAULT '[]',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_id, name)
);

CREATE TABLE IF NOT EXISTS attendance (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  owner_id     UUID REFERENCES owners(id) ON DELETE CASCADE NOT NULL,
  date         DATE NOT NULL,
  entry_time   TIMESTAMPTZ,
  exit_time    TIMESTAMPTZ,
  is_late      BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, date)
);

CREATE TABLE IF NOT EXISTS settings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID REFERENCES owners(id) ON DELETE CASCADE UNIQUE NOT NULL,
  arrival_time     TIME NOT NULL DEFAULT '09:00',
  departure_time   TIME NOT NULL DEFAULT '17:00',
  report_frequency TEXT NOT NULL DEFAULT 'weekly',
  report_email     TEXT DEFAULT '',
  report_enabled   BOOLEAN DEFAULT FALSE,
  smtp_host        TEXT DEFAULT 'smtp.gmail.com',
  smtp_user        TEXT DEFAULT '',
  smtp_pass        TEXT DEFAULT '',
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- AUTO-CREATE OWNER ON SIGNUP (handles Google OAuth too)
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO owners (user_id, email, org_name)
  VALUES (NEW.id, NEW.email, 'My Organization')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────

ALTER TABLE owners     ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees  ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings   ENABLE ROW LEVEL SECURITY;

-- Helper: get the owner.id for the currently logged-in user
CREATE OR REPLACE FUNCTION my_owner_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM owners WHERE user_id = auth.uid() LIMIT 1;
$$;

-- owners: user can only access their own record
DROP POLICY IF EXISTS "owners_all" ON owners;
CREATE POLICY "owners_all" ON owners FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- employees: owner can only access their own employees
DROP POLICY IF EXISTS "employees_all" ON employees;
CREATE POLICY "employees_all" ON employees FOR ALL
  USING (owner_id = my_owner_id())
  WITH CHECK (owner_id = my_owner_id());

-- attendance: owner can only access their own records
DROP POLICY IF EXISTS "attendance_all" ON attendance;
CREATE POLICY "attendance_all" ON attendance FOR ALL
  USING (owner_id = my_owner_id())
  WITH CHECK (owner_id = my_owner_id());

-- settings: owner can only access their own settings
DROP POLICY IF EXISTS "settings_all" ON settings;
CREATE POLICY "settings_all" ON settings FOR ALL
  USING (owner_id = my_owner_id())
  WITH CHECK (owner_id = my_owner_id());

-- ────────────────────────────────────────────────────────────
-- STORAGE BUCKET
-- Run this block separately if bucket doesn't exist yet
-- ────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-photos', 'employee-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "photos_owner_insert" ON storage.objects;
CREATE POLICY "photos_owner_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'employee-photos' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "photos_public_select" ON storage.objects;
CREATE POLICY "photos_public_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'employee-photos');

DROP POLICY IF EXISTS "photos_owner_delete" ON storage.objects;
CREATE POLICY "photos_owner_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'employee-photos' AND auth.uid() IS NOT NULL);
