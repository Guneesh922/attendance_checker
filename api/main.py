"""
Mark-it Attendance — FastAPI backend (minimal, v3).

Face recognition runs in the browser (face-api.js).
This backend only handles: health check + email report delivery.

Run locally:  uvicorn api.main:app --reload --port 8000
Render:       uvicorn api.main:app --host 0.0.0.0 --port 8000
"""

import io
import base64
import csv
import os
import os
import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from api.auth import verify_token

load_dotenv()
logger = logging.getLogger(__name__)

app = FastAPI(title="Mark-it API", version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class EmailReportBody(BaseModel):
    smtp_user: str
    smtp_pass: str
    recipients: str
    subject: str
    html_body: str


@app.get("/health")
def health():
    return {"status": "ok", "version": "3.0.0"}


@app.post("/reports/send-email", dependencies=[Depends(verify_token)])
def send_report_email(body: EmailReportBody):
    """Send an HTML email report via Gmail SMTP (App Password required)."""
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = body.subject
        msg["From"] = body.smtp_user
        msg["To"] = body.recipients
        msg.attach(MIMEText(body.html_body, "html"))
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(body.smtp_user, body.smtp_pass)
            server.sendmail(body.smtp_user, body.recipients.split(","), msg.as_string())
        return {"ok": True}
    except Exception as e:
        logger.error(f"Email send failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
