-- db/migrate.sql
-- Run this ONCE in your Supabase SQL Editor to create the PostgreSQL schema.
-- Updated for multi-tenant support with Firebase authentication.

CREATE TABLE IF NOT EXISTS owner (
    id              SERIAL PRIMARY KEY,
    name            TEXT UNIQUE,
    password        TEXT,
    email           TEXT,
    image_path      TEXT,
    firebase_uid    TEXT UNIQUE,      -- Firebase UID for multi-tenant lookup
    created_at      TEXT
);

CREATE TABLE IF NOT EXISTS employees (
    id          SERIAL PRIMARY KEY,
    owner_id    INTEGER REFERENCES owner(id) ON DELETE CASCADE,
    name        TEXT,
    role        TEXT,
    image_path  TEXT,          -- Cloudinary URL
    UNIQUE(owner_id, name)     -- Each owner can have employees with same name
);

CREATE TABLE IF NOT EXISTS employee_images (
    id          SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    image_path  TEXT,          -- Cloudinary URL
    blob_name   TEXT,          -- Cloudinary public_id for deletion
    created_at  TEXT
);

CREATE TABLE IF NOT EXISTS attendance (
    id          SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    date        TEXT,          -- YYYY-MM-DD
    entry_time  TEXT,          -- HH:MM:SS
    exit_time   TEXT           -- HH:MM:SS or NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- Critical for 300-employee performance.
-- Monthly report (300 × 30 = 9,000 rows) runs in < 10ms with these indexes.
CREATE INDEX IF NOT EXISTS idx_attendance_date
    ON attendance(date);

CREATE INDEX IF NOT EXISTS idx_attendance_emp_date
    ON attendance(employee_id, date);

INSERT INTO settings (key, value) VALUES
    ('min_work_hours',    '4'),
    ('late_after_time',   '09:30:00'),
    ('min_departure_time','17:00:00'),
    ('email_enabled',     '0')
ON CONFLICT (key) DO NOTHING;
