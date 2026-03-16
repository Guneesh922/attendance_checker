# QUICK START GUIDE

## Current Status ✅

### Services Running
- **Backend**: FastAPI on `http://localhost:8000` ✅
- **Frontend**: Next.js on `http://localhost:3000` ✅
- **Database**: Supabase PostgreSQL (cloud)
- **Images**: Cloudinary (cloud)

## What Was Fixed

### Critical Bugs Fixed
1. ✅ **422 Unprocessable Entity Error** - Fixed Form(...) on path parameters in API routes
2. ✅ **Multi-tenant Schema** - Added owner_id column to employees table
3. ✅ **Image Upload** - Fixed return type mismatch in upload_face_image()
4. ✅ **Endpoint Syntax** - Corrected all FastAPI route decorators

### Files Cleaned Up
- Removed `main.py` (legacy GUI app)
- Removed `attendance.db` (legacy SQLite database)
- Removed `Employee_Images/` and `Owner_Images/` (local storage, using Cloudinary now)
- Removed all `__pycache__` directories
- Removed `.DS_Store` (macOS system file)
- Updated `db/migrate.sql` for current schema

## How to Test

### 1. Signup (Register New Organization)
```
URL: http://localhost:3000/signup
Steps:
1. Enter Organization Name (e.g., "Acme Corp")
2. Enter Email (e.g., "owner@acme.com")
3. Enter Password (6+ characters)
4. Click "Sign Up"
5. Should redirect to Dashboard
```

### 2. Register Employee
```
URL: http://localhost:3000/employees
Steps:
1. Enter Employee Name
2. Enter Employee Role
3. Click "Start Camera"
4. Position face in frame
5. Click "Capture & Register"
6. Image uploads to Cloudinary
7. Employee added to database
```

### 3. Mark Attendance
```
URL: http://localhost:3000/attendance
Steps:
1. Click "Start Camera"
2. System recognizes employee face
3. Click "Entry" or "Exit"
4. Attendance recorded
```

## API Endpoints

### Authentication
- `POST /auth/register-owner` - Register new organization (no auth required)
- `GET /auth/me` - Get current owner info (Bearer token required)

### Employees
- `GET /employees/` - List employees for current owner
- `POST /employees/` - Register new employee (multipart form-data)
- `PUT /employees/{name}` - Update employee
- `DELETE /employees/{name}` - Delete employee
- `POST /employees/{name}/images` - Add extra image for employee
- `GET /employees/{name}/images` - Get employee images

### Recognition
- `POST /recognize` - Recognize faces in image

### Attendance
- `POST /attendance/entry` - Mark entry
- `POST /attendance/exit` - Mark exit
- `GET /attendance/today` - Today's attendance
- `GET /attendance/date/{date}` - Attendance by date
- `GET /attendance/month/{year}/{month}` - Monthly attendance

### Settings
- `GET /settings/` - Get all settings
- `PUT /settings/` - Update settings
- `POST /attendance/send-email` - Send report email

## Multi-Tenant Architecture

### How It Works
1. **Signup**: User creates account with Firebase (email/password)
2. **Owner Registration**: Backend stores owner in PostgreSQL with Firebase UID
3. **Employee Registration**: Each employee tagged with owner_id
4. **Data Isolation**: Queries filtered by owner_id from Firebase token
5. **Image Storage**: Cloudinary URLs stored in database with owner isolation

### Data Flow
```
Browser (Firebase Auth)
    ↓
Firebase Token (with uid)
    ↓
FastAPI Backend
    ↓
Extract uid from token
    ↓
Lookup owner_id from PostgreSQL
    ↓
Filter all queries by owner_id
    ↓
Data isolated per organization
```

## Database Schema

### owner table
- id (SERIAL PRIMARY KEY)
- name (TEXT UNIQUE)
- email (TEXT)
- firebase_uid (TEXT UNIQUE) ← Used for multi-tenant lookup
- password (TEXT - legacy, can be removed)
- image_path (TEXT - legacy, can be removed)
- created_at (TEXT)

### employees table
- id (SERIAL PRIMARY KEY)
- owner_id (INTEGER REFERENCES owner ON DELETE CASCADE) ← Multi-tenant
- name (TEXT)
- role (TEXT)
- image_path (TEXT - Cloudinary URL)
- UNIQUE(owner_id, name) ← Each owner can have employees with same name

### employee_images table
- id (SERIAL PRIMARY KEY)
- employee_id (FOREIGN KEY)
- image_path (Cloudinary secure HTTPS URL)
- blob_name (Cloudinary public_id for deletion)
- created_at (TEXT)

### attendance table
- id (SERIAL PRIMARY KEY)
- employee_id (FOREIGN KEY)
- date (TEXT YYYY-MM-DD)
- entry_time (TEXT HH:MM:SS)
- exit_time (TEXT HH:MM:SS or NULL)

## Debugging

### Backend Logs
```bash
# Already running, check /tmp/backend.log
tail -f /tmp/backend.log
```

### Frontend Logs
```bash
# Already running, check /tmp/frontend.log
tail -f /tmp/frontend.log
```

### Check Backend Health
```bash
curl http://localhost:8000/docs
```

### Check API Response
```bash
curl -H "Authorization: Bearer <TOKEN>" http://localhost:8000/employees/
```

## Common Issues

### 422 Unprocessable Entity ✅ FIXED
- Was caused by Form(...) on path parameters
- Fixed in api/main.py

### Employee Registration Fails ✅ FIXED
- Was missing owner_id in database schema
- Added migration to add owner_id column
- Now properly tags employees to owner

### Image Upload Fails ✅ FIXED
- upload_face_image() return type was wrong
- Now returns (url, public_id) tuple
- delete_face_image() uses public_id directly

## Next Steps (Optional)

1. **Deployment**: Push to Railway (backend) and Vercel (frontend)
2. **Production DB**: Use Supabase for production (currently using development URL)
3. **Email Reports**: Configure Gmail app password in settings
4. **SSL/HTTPS**: Deploy with proper SSL certificates
5. **Domain Setup**: Use custom domain instead of localhost

## File Structure
```
├── api/
│   ├── main.py ............ FastAPI application with 21+ endpoints
│   ├── auth.py ............ Firebase authentication & token verification
│   ├── database.py ........ PostgreSQL connection pooling
│   └── storage.py ......... Cloudinary image upload/delete
├── frontend/
│   ├── app/
│   │   ├── page.tsx ....... Dashboard
│   │   ├── login/page.tsx . Login page
│   │   ├── signup/page.tsx  Signup/registration page
│   │   ├── employees/     . Employee management
│   │   ├── attendance/    . Attendance tracking
│   │   ├── reports/      . Attendance reports
│   │   └── settings/     . Settings/config
│   ├── lib/
│   │   ├── api.ts ......... API client (axios)
│   │   └── firebase.ts .... Firebase config
│   ├── hooks/
│   │   └── useCamera.ts ... Camera capture hook
│   └── middleware.ts ...... Route protection
├── backend.py ............ Core business logic (1300+ lines)
├── email_reporter.py ..... Email report generation
├── requirements.txt ...... Python dependencies
├── db/
│   └── migrate.sql ....... Database schema (updated for multi-tenant)
├── FIXES_APPLIED.md ...... Summary of fixes (you are here)
└── .env .................. Configuration (DATABASE_URL, Cloudinary creds, etc.)
```

## Success Indicators

- ✅ Backend starts without errors
- ✅ Frontend starts without errors
- ✅ Can signup with new organization
- ✅ Can login after signup
- ✅ Can register employees
- ✅ Images upload to Cloudinary
- ✅ Multiple organizations have isolated data
- ✅ Dashboard shows correct attendance

---
**Last Updated**: March 16, 2026
**Status**: All critical issues resolved ✅
**Ready for**: Testing and deployment

