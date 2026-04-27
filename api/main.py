"""
api/main.py
───────────
FastAPI application — replaces the CustomTkinter main.py as the entry point.

All 21 REST endpoints live here. The AttendanceBackend singleton is created
once at startup (loads all face encodings into RAM). A background thread
replicates the original App._whatsapp_tick email scheduler.

Run locally:
  uvicorn api.main:app --reload --port 8000

Docker / Render:
  uvicorn api.main:app --host 0.0.0.0 --port 8000 --workers 1
  (1 worker is intentional — face_recognition is not multi-worker safe)
"""

import io
import base64
import csv
import os
import threading
import time as time_module
import logging
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv
load_dotenv()

import cv2
import numpy as np
import requests
import face_recognition
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from firebase_admin import auth as fb_auth
from pydantic import BaseModel

from api.auth import verify_token
from backend import AttendanceBackend, FACE_RECOGNITION_TOLERANCE
from email_reporter import build_email_report, send_email_report

logger = logging.getLogger(__name__)

# ── App init ──────────────────────────────────────────────────────────────────

app = FastAPI(title="Attendance System API", version="2.0.0")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allow all origins to support dynamic Vercel preview URLs
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}


# Singleton — all face encodings live here in RAM (~1.5 MB for 300 employees)
backend: AttendanceBackend = None  # type: ignore[assignment]


# ── Email scheduler (mirrors App._whatsapp_tick) ──────────────────────────────

def _email_scheduler_loop() -> None:
    """Background daemon thread — checks every 60 s and fires at configured HH:MM."""
    while True:
        time_module.sleep(60)
        try:
            enabled = backend.get_setting("email_enabled", "0")
            if enabled != "1":
                continue
            report_time = backend.get_setting("email_report_time", "")
            if not report_time:
                continue
            now = datetime.now().strftime("%H:%M")
            if now == report_time:
                rows = backend.get_today_attendance()
                subject, html = build_email_report(rows)
                sender = backend.get_setting("email_sender", "")
                pwd = backend.get_setting("email_app_password", "")
                
                # Get recipients: use owner's registration email + any additional recipients
                owner_email = backend.get_owner_email()
                custom_recips = backend.get_setting("email_recipients", "")
                
                # Build recipient list: owner email + custom recipients
                recips_list = []
                if owner_email:
                    recips_list.append(owner_email)
                if custom_recips:
                    recips_list.extend([e.strip() for e in custom_recips.split(",") if e.strip()])
                
                recips = ",".join(recips_list) if recips_list else ""
                
                if sender and pwd and recips:
                    send_email_report(sender, pwd, recips, subject, html)
                    logger.info(f"Email report sent to: {recips}")
        except Exception as e:
            logger.error(f"Email scheduler error: {e}", exc_info=True)


# ── Startup / shutdown ────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup() -> None:
    global backend
    backend = AttendanceBackend()
    t = threading.Thread(target=_email_scheduler_loop, daemon=True)
    t.start()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _decode_upload(data: bytes) -> np.ndarray:
    """Decode raw image bytes (uploaded via multipart) into an OpenCV BGR frame."""
    arr = np.frombuffer(data, np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image — upload a valid JPEG or PNG.")
    return frame


def _get_owner_id(token: dict) -> int:
    """Get the owner ID from the Firebase token (uid)."""
    firebase_uid = token.get("uid")
    if not firebase_uid:
        raise HTTPException(status_code=401, detail="No uid in token")
    owner_id = backend.get_owner_id_from_firebase_uid(firebase_uid)
    if not owner_id:
        email = token.get("email")
        if email:
            logger.warning(f"Auto-registering orphaned Firebase user: {email}")
            backend.register_owner_firebase(email, "Organization", firebase_uid)
            owner_id = backend.get_owner_id_from_firebase_uid(firebase_uid)
        if not owner_id:
            raise HTTPException(status_code=401, detail="Owner not found")
    return owner_id


# ── Pydantic models ───────────────────────────────────────────────────────────

class NameBody(BaseModel):
    name: str

class FrameBody(BaseModel):
    image_b64: str  # base64-encoded JPEG from the browser webcam canvas

class SettingsBody(BaseModel):
    data: dict[str, str]

class EmailConfigBody(BaseModel):
    sender: str
    app_password: str
    recipients: str
    report_time: Optional[str] = None
    enabled: Optional[bool] = None

class RegisterOwnerBody(BaseModel):
    email: str
    organization_name: str
    uid: str

class FaceLoginBody(BaseModel):
    email: str
    image_b64: str  # base64-encoded JPEG from the browser webcam canvas


# ── Auth ──────────────────────────────────────────────────────────────────────

@app.get("/auth/me")
def get_me(token: dict = Depends(verify_token)):
    return {
        "uid": token["uid"],
        "email": token.get("email"),
        "name": backend.get_owner_name(),
    }


@app.post("/auth/register-owner")
def register_owner_endpoint(body: RegisterOwnerBody):
    """
    Register a new owner/organization when they sign up via Firebase.
    Called after Firebase user creation to store owner data in PostgreSQL.
    
    Does NOT require token verification since it's called immediately after
    Firebase signup with the newly created user's Firebase UID.
    """
    try:
        result = backend.register_owner_firebase(
            email=body.email,
            organization_name=body.organization_name,
            firebase_uid=body.uid
        )
        return result
    except Exception as e:
        logger.error(f"Error registering owner: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/auth/login-with-face")
async def login_with_face(body: FaceLoginBody):
    """
    Authenticate an owner using face recognition and return a Firebase custom token.
    No existing auth token required — this IS the login step.

    Flow:
      1. Look up owner by email → get stored face image URL and firebase_uid
      2. Compare submitted face against stored face
      3. On match → issue a Firebase custom token so the client can call
         signInWithCustomToken() to complete login
    """
    try:
        email = body.email.lower().strip()

        # Fetch owner record by email
        backend.cur.execute(
            "SELECT id, image_path, firebase_uid FROM owner WHERE email=%s",
            (email,)
        )
        row = backend.cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="No account found for this email")

        owner_id, img_path, firebase_uid = row

        if not img_path or not img_path.startswith("https://"):
            return {"authenticated": False, "reason": "no_face_registered"}

        if not firebase_uid:
            return {"authenticated": False, "reason": "account_incomplete"}

        # Decode the submitted face image
        try:
            raw = base64.b64decode(body.image_b64)
        except Exception:
            raise HTTPException(status_code=400, detail="image_b64 is not valid base64")
        frame = _decode_upload(raw)

        # Download and compare against stored owner face
        resp = requests.get(img_path, timeout=10)
        resp.raise_for_status()
        arr = np.frombuffer(resp.content, np.uint8)
        stored_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if stored_bgr is None:
            logger.warning(f"Could not decode stored owner image for {email}")
            return {"authenticated": False, "reason": "stored_image_invalid"}

        stored_rgb = cv2.cvtColor(stored_bgr, cv2.COLOR_BGR2RGB)
        stored_encs = face_recognition.face_encodings(stored_rgb)
        if not stored_encs:
            return {"authenticated": False, "reason": "no_face_in_stored_image"}

        live_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        live_encs = face_recognition.face_encodings(live_rgb)
        if not live_encs:
            return {"authenticated": False, "reason": "no_face_detected"}

        matches = face_recognition.compare_faces([stored_encs[0]], live_encs[0], tolerance=FACE_RECOGNITION_TOLERANCE)
        if not matches[0]:
            logger.info(f"Face login failed for {email}")
            return {"authenticated": False, "reason": "face_mismatch"}

        # Face matched — create a Firebase custom token
        custom_token = fb_auth.create_custom_token(firebase_uid)
        # create_custom_token returns bytes
        token_str = custom_token.decode("utf-8") if isinstance(custom_token, bytes) else custom_token

        logger.info(f"Face login SUCCESS for {email}")
        return {"authenticated": True, "custom_token": token_str}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in login-with-face: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/auth/register-owner-face", dependencies=[Depends(verify_token)])
async def register_owner_face(
    file: UploadFile = File(...),
    token: dict = Depends(verify_token),
):
    """
    Capture and store owner's face image during onboarding.
    Called after owner signs up to enable face-based authentication.
    
    This allows the owner to later use face recognition to access
    settings, add employees, and view data.
    """
    try:
        owner_id = _get_owner_id(token)
        data = await file.read()
        frame = _decode_upload(data)
        
        # Encode frame to JPEG and upload to Cloudinary
        ok, buf = cv2.imencode(".jpg", frame)
        if not ok:
            raise IOError("Failed to encode frame as JPEG")
        
        from api.storage import upload_face_image
        img_url, blob_name = upload_face_image("owner", buf.tobytes())
        
        # Store owner face image URL in database
        backend.cur.execute(
            "UPDATE owner SET image_path=%s WHERE id=%s",
            (img_url, owner_id)
        )
        backend.conn.commit()
        
        logger.info(f"Owner face registered successfully for owner_id {owner_id}")
        return {"ok": True, "message": "Owner face registered successfully"}
        
    except Exception as e:
        logger.error(f"Error registering owner face: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/auth/verify-owner-face", dependencies=[Depends(verify_token)])
async def verify_owner_face(
    body: FrameBody,
    token: dict = Depends(verify_token),
):
    """
    Verify owner's identity using face recognition.
    Called before accessing protected settings or sensitive operations.
    
    Returns:
      { "authenticated": true }  if face matches stored image
      { "authenticated": false } if face does not match
    """
    try:
        owner_id = _get_owner_id(token)
        
        # Decode base64 image
        raw = base64.b64decode(body.image_b64)
        frame = _decode_upload(raw)
        
        # Call backend face authentication
        is_authenticated = backend.authenticate_owner(frame)
        
        logger.info(f"Owner face verification: {'SUCCESS' if is_authenticated else 'FAILED'} for owner_id {owner_id}")
        
        return {
            "authenticated": is_authenticated,
            "message": "Face verified successfully" if is_authenticated else "Face not recognized"
        }
        
    except Exception as e:
        logger.error(f"Error verifying owner face: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── Employees ─────────────────────────────────────────────────────────────────

@app.get("/employees/", dependencies=[Depends(verify_token)])
def list_employees(token: dict = Depends(verify_token)):
    owner_id = _get_owner_id(token)
    return [{"name": n, "role": r} for n, r in backend.get_employee_list(owner_id=owner_id)]


@app.post("/employees/", dependencies=[Depends(verify_token)])
async def register_employee(
    name: str = Form(...),
    role: str = Form(...),
    file: UploadFile = File(...),
    token: dict = Depends(verify_token),
):
    try:
        logger.info(f"Registering employee: {name}, role: {role}, file: {file.filename}")
        owner_id = _get_owner_id(token)
        logger.info(f"Owner ID: {owner_id}")
        data = await file.read()
        logger.info(f"Read {len(data)} bytes from file")
        frame = _decode_upload(data)
        logger.info(f"Decoded frame shape: {frame.shape if hasattr(frame, 'shape') else 'unknown'}")
        backend.register_employee(name, role, frame, owner_id=owner_id)
        logger.info(f"Employee {name} registered successfully for owner {owner_id}")
        return {"ok": True}
    except Exception as e:
        logger.error(f"Error registering employee: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/employees/{name}", dependencies=[Depends(verify_token)])
async def update_employee(
    name: str,
    new_name: str = Form(...),
    new_role: str = Form(...),
    file: Optional[UploadFile] = File(None),
):
    frame = None
    if file:
        data = await file.read()
        frame = _decode_upload(data)
    backend.update_employee(name, new_name, new_role, frame)
    return {"ok": True}


@app.delete("/employees/{name}", dependencies=[Depends(verify_token)])
def delete_employee(name: str):
    backend.delete_employee(name)
    return {"ok": True}


@app.post("/employees/{name}/images", dependencies=[Depends(verify_token)])
async def add_face_image(name: str, file: UploadFile = File(...)):
    data = await file.read()
    frame = _decode_upload(data)
    ok = backend.add_employee_image(name, frame)
    if not ok:
        raise HTTPException(400, f"Could not add image for '{name}'")
    return {"ok": True}


@app.get("/employees/{name}/images", dependencies=[Depends(verify_token)])
def get_employee_images(name: str):
    return {"images": backend.get_employee_images(name)}


# ── Face recognition ──────────────────────────────────────────────────────────

@app.post("/recognize", dependencies=[Depends(verify_token)])
def recognize(body: FrameBody):
    """
    Accepts a base64-encoded JPEG captured from the browser webcam.
    Returns a list of recognised employee names.
    """
    try:
        raw = base64.b64decode(body.image_b64)
    except Exception:
        raise HTTPException(400, "image_b64 is not valid base64.")
    frame = _decode_upload(raw)
    names = backend.recognize_faces(frame)
    return {"names": names}


# ── Attendance ────────────────────────────────────────────────────────────────

@app.post("/attendance/entry", dependencies=[Depends(verify_token)])
def mark_entry(body: NameBody):
    ok = backend.mark_entry(body.name)
    return {"ok": ok}


@app.post("/attendance/exit", dependencies=[Depends(verify_token)])
def mark_exit(body: NameBody):
    ok = backend.mark_exit(body.name)
    return {"ok": ok}


@app.get("/attendance/today", dependencies=[Depends(verify_token)])
def today():
    rows = backend.get_today_attendance()
    return [{"name": r[0], "role": r[1], "entry": r[2], "exit": r[3]} for r in rows]


@app.get("/attendance/date/{date_str}", dependencies=[Depends(verify_token)])
def by_date(date_str: str):
    rows = backend.get_attendance_by_date(date_str)
    return [{"name": r[0], "role": r[1], "entry": r[2], "exit": r[3]} for r in rows]


@app.get("/attendance/month/{year}/{month}", dependencies=[Depends(verify_token)])
def by_month(year: int, month: int):
    rows = backend.get_attendance_by_month(year, month)
    return [{"name": r[0], "role": r[1], "date": r[2], "entry": r[3], "exit": r[4]} for r in rows]


@app.get("/attendance/irregulars/{year}/{month}", dependencies=[Depends(verify_token)])
def irregulars(year: int, month: int):
    rows = backend.get_monthly_irregulars(year, month)
    return [{"name": r[0], "role": r[1], "absent_days": r[2], "late_days": r[3], "dates": r[4]} for r in rows]


@app.get("/attendance/export/csv", dependencies=[Depends(verify_token)])
def export_csv(
    date: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
):
    buf = io.StringIO()
    writer = csv.writer(buf)

    if date:
        rows = backend.get_attendance_by_date(date)
        writer.writerow(["Name", "Role", "Entry", "Exit"])
        writer.writerows(rows)
        filename = f"attendance_{date}.csv"
    elif year and month:
        rows = backend.get_attendance_by_month(year, month)
        writer.writerow(["Name", "Role", "Date", "Entry", "Exit"])
        writer.writerows(rows)
        filename = f"attendance_{year}_{month:02d}.csv"
    else:
        rows = backend.get_today_attendance()
        writer.writerow(["Name", "Role", "Entry", "Exit"])
        writer.writerows(rows)
        today_str = datetime.now().strftime("%Y-%m-%d")
        filename = f"attendance_{today_str}.csv"

    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ── Settings ──────────────────────────────────────────────────────────────────

ALLOWED_SETTING_KEYS = {
    "min_work_hours",
    "late_after_time",
    "min_departure_time",
    "email_sender",
    "email_app_password",
    "email_recipients",
    "email_report_time",
    "email_enabled",
}


@app.get("/settings/", dependencies=[Depends(verify_token)])
def get_settings():
    return {k: backend.get_setting(k) for k in ALLOWED_SETTING_KEYS}


@app.put("/settings/", dependencies=[Depends(verify_token)])
def update_settings(body: SettingsBody):
    for key, value in body.data.items():
        if key in ALLOWED_SETTING_KEYS:
            backend.set_setting(key, value)
    return {"ok": True}


# ── Email ─────────────────────────────────────────────────────────────────────

@app.post("/email/send", dependencies=[Depends(verify_token)])
def manual_send():
    rows = backend.get_today_attendance()
    subject, html = build_email_report(rows)
    sender = backend.get_setting("email_sender", "")
    pwd = backend.get_setting("email_app_password", "")
    recips = backend.get_setting("email_recipients", "")
    if not sender or not pwd or not recips:
        raise HTTPException(400, "Gmail credentials not configured. Go to Settings first.")
    ok = send_email_report(sender, pwd, recips, subject, html)
    return {"ok": ok}


@app.put("/email/config", dependencies=[Depends(verify_token)])
def set_email_config(body: EmailConfigBody):
    backend.set_setting("email_sender", body.sender)
    backend.set_setting("email_app_password", body.app_password)
    backend.set_setting("email_recipients", body.recipients)
    if body.report_time is not None:
        backend.set_setting("email_report_time", body.report_time)
    if body.enabled is not None:
        backend.set_setting("email_enabled", "1" if body.enabled else "0")
    return {"ok": True}
