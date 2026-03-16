# Fixes Applied - March 16, 2026

## Issues Found and Fixed

### 1. **422 Unprocessable Entity Error**

**Root Causes:**
- Multiple FastAPI endpoints had Form(...) parameters for path variables (which should be path-only)
- Line 206: `update_employee` had `name: str=Form(...)` but name is in path as `/employees/{name}`
- Line 227: `add_face_image` had `name: str=Form(...)` but name is in path as `/employees/{name}/images`

**Files Fixed:** `api/main.py`
- Fixed `@app.put("/employees/{name}")` - removed `=Form(...)` from name parameter
- Fixed `@app.post("/employees/{name}/images")` - removed `=Form(...)` from name parameter
- Added proper logging and error handling to register_employee endpoint

### 2. **Multi-Tenant Database Schema Issues**

**Problem:** Employees table was missing `owner_id` column needed for multi-tenant support

**Files Fixed:** `backend.py`
- Updated CREATE TABLE statement to include `owner_id INTEGER REFERENCES owner(id)`
- Changed unique constraint from `name TEXT UNIQUE` to `UNIQUE(owner_id, name)`
- Added migration method `_ensure_employees_owner_id_column()` for existing databases
- Updated `register_employee()` to accept and use `owner_id`
- Updated `get_employee_list()` to optionally filter by owner_id

**Files Fixed:** `api/main.py`
- Added `_get_owner_id()` helper to extract owner ID from Firebase token
- Updated `/employees/` GET endpoint to pass owner_id to backend
- Updated `/employees/` POST endpoint to extract owner_id from token

### 3. **Image Upload Return Type Mismatch**

**Problem:** `upload_face_image()` returned only URL string but backend expected tuple (url, public_id)

**Files Fixed:** `api/storage.py`
- Updated `upload_face_image()` to return tuple `(url, public_id)` instead of just URL
- Updated `delete_face_image()` to accept `public_id` directly instead of parsing from URL

### 4. **Unnecessary Files Cleanup**

**Removed:**
- `main.py` - Legacy CustomTkinter GUI (replaced by FastAPI backend)
- `attendance.db` - Old SQLite database (replaced by PostgreSQL)
- `.DS_Store` - macOS system file
- `Employee_Images/` directory - Local image storage (replaced by Cloudinary)
- `Owner_Images/` directory - Local image storage (replaced by Cloudinary)
- All `__pycache__/` directories

**Kept:**
- `.env` - Configuration values
- `.env.example` - Configuration template
- `backend.py` - Core business logic
- `email_reporter.py` - Email functionality
- `requirements.txt` - Dependencies
- `api/` - FastAPI application
- `frontend/` - Next.js web app
- `db/` - Database migration scripts

### 5. **Database Migration Script Update**

**Files Fixed:** `db/migrate.sql`
- Updated schema to include `owner_id` in employees table
- Updated schema to include `firebase_uid` in owner table for multi-tenant lookup
- Updated comments to reflect Cloudinary usage instead of Firebase Storage
- Removed outdated default settings seed (handled in code now)

## Architecture Summary

### Frontend (Next.js)
- Located in `frontend/` directory
- Port: 3001
- Handles signup, login, employee registration with camera capture
- Sends Firebase Bearer token with all API requests

### Backend (FastAPI)
- Located in `api/main.py` and `backend.py`
- Port: 8000
- Receives requests with Firebase token
- Extracts owner_id from token using `get_owner_id_from_firebase_uid()`
- All employee operations filtered by owner_id for multi-tenant isolation

### Database (Supabase PostgreSQL)
- URL: `postgresql://...aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres`
- Multi-tenant schema with owner-employee relationship
- Employees table has UNIQUE(owner_id, name) constraint

### Image Storage (Cloudinary)
- Free tier, no credit card required
- Public IDs stored in database for deletion
- Secure HTTPS URLs used throughout

## Testing Checklist

- [ ] Backend starts successfully on port 8000
- [ ] Frontend starts successfully on port 3001
- [ ] Can signup with new organization name
- [ ] Can login with created account
- [ ] Can register employee with camera capture
- [ ] Image uploads to Cloudinary successfully
- [ ] Multiple owners can register without interference
- [ ] Each owner only sees their own employees

## Next Steps

1. Start backend: `cd /path/to/project && source .venv/bin/activate && python -m uvicorn api.main:app --reload --port 8000`
2. Start frontend: `cd /path/to/project/frontend && npm run dev`
3. Test signup flow at `http://localhost:3001/signup`
4. Test employee registration at `http://localhost:3001/employees`

