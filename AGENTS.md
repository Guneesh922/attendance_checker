# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview
- Desktop attendance system with a single-process Python GUI (`customtkinter`) and local persistence (`sqlite3`).
- Face recognition is handled locally via `face_recognition`/`dlib`; camera access is via OpenCV.
- Main runtime entrypoint is `main.py`; there is no separate service/backend process.

## Setup and Run Commands
- Install dependencies (order matters for `dlib`/`face_recognition`):
  - `pip3 install cmake`
  - `pip3 install dlib==19.24.2`
  - `pip3 install -r requirements.txt`
- Run the app:
  - `python3 main.py`

## Build, Lint, and Test Status
- Build/package step: not configured in this repository (runs directly as a Python app).
- Linting: no lint tool config is present (`ruff`, `flake8`, `pylint`, etc. are not configured).
- Automated tests: no test suite/config is present (`pytest`/`unittest` test files are not included).
- Single-test command: not available in current repository state because no tests are defined.

## High-Level Architecture
### 1) UI and screen orchestration (`main.py`)
- `App` is the top-level controller that owns one `AttendanceBackend` instance and swaps screen frames in a single window.
- Screen flow is stateful and frame-based:
  - Owner bootstrap: `OwnerRegister` when no owner exists.
  - Auth gate: `LoginScreen` (face + password) for protected areas.
  - Operational screens: `Dashboard`, `Register`, `Attendance`, `AttendanceTable`, `SettingsFrame`.
- `App` also runs a periodic scheduler (`_whatsapp_tick`) every 60s to send the daily email report when configured time matches.

### 2) Domain logic and persistence (`backend.py`)
- `AttendanceBackend` is the central domain/data layer used by all UI screens.
- SQLite tables:
  - `owner`: admin identity + password + owner face image path.
  - `employees`: canonical employee records.
  - `employee_images`: multiple face images per employee (used for recognition robustness).
  - `attendance`: daily entry/exit rows keyed by employee/date.
  - `settings`: persisted thresholds and email scheduler/config values.
- Initialization side effects:
  - Creates tables if needed.
  - Deletes attendance rows from older years.
  - Loads persisted settings into in-memory attributes.
  - Loads all face encodings for recognition.

### 3) Recognition and attendance flow
- Employee/owner images are written to disk (`Employee_Images/`, `Owner_Images/`), and face encodings are derived from those files.
- Attendance capture loop in `Attendance` frame:
  - Grabs camera frames.
  - Runs `backend.recognize_faces(frame)` on a cooldown.
  - Enables Entering/Leaving actions only after known faces are detected.
- Write path:
  - Entering -> `mark_entry(name)` creates attendance row for today if one does not exist.
  - Leaving -> `mark_exit(name)` updates today’s open row (`exit_time IS NULL`).

### 4) Reporting and analytics path
- Today report (`get_today_attendance`) powers dashboard stats, Today table, CSV export, and email payload generation.
- Search views call `get_attendance_by_date` and `get_attendance_by_month`.
- Monthly irregulars (`get_monthly_irregulars`) compute per-employee anomalies using persisted settings:
  - late arrival threshold (`late_after_time`)
  - minimum work hours (`min_work_hours`)
  - minimum departure time (`min_departure_time`)

### 5) Email reporting (`email_reporter.py`)
- Outbound email uses Gmail SMTP (`smtp.gmail.com:587`) with STARTTLS and App Password auth.
- `build_email_report` renders HTML summary from today’s attendance rows.
- Two trigger paths:
  - Automatic daily send via scheduler in `App._whatsapp_tick`.
  - Manual send from Today report view (“Send Report via Email”).

## Important Repository-Specific Notes
- `requirements.txt` explicitly depends on install ordering; keep `dlib` installed before `face-recognition`.
- Credentials for email sending are persisted in local `attendance.db` settings rows and consumed directly by scheduler/manual send paths.
- Recognition accuracy depends on `employee_images`; employee create/update paths call `_load_faces()` to refresh in-memory encodings immediately.
