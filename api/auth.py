"""
api/auth.py
───────────
Firebase Admin SDK initialisation + ID token verification.

Every protected FastAPI route uses verify_token() as a Depends() dependency.

Environment variables required (one of the following):
  FIREBASE_SERVICE_ACCOUNT_JSON — path to the service account key JSON file
                                  e.g. /app/secrets/firebase-sa.json
  FIREBASE_CREDENTIALS_JSON     — the actual JSON payload as a string
"""

import os
import logging
import firebase_admin
from firebase_admin import auth, credentials
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

logger = logging.getLogger(__name__)

# Initialise Firebase Admin once at module import time.
# Guard prevents re-initialisation if the module is reloaded.
if not firebase_admin._apps:
    if "FIREBASE_CREDENTIALS_JSON" in os.environ:
        import json
        cert_dict = json.loads(os.environ["FIREBASE_CREDENTIALS_JSON"])
        cred = credentials.Certificate(cert_dict)
        firebase_admin.initialize_app(cred)
        logger.info("Firebase Admin SDK initialised from JSON environment variable")
    else:
        sa_path = os.environ["FIREBASE_SERVICE_ACCOUNT_JSON"]
        cred = credentials.Certificate(sa_path)
        firebase_admin.initialize_app(cred)
        logger.info(f"Firebase Admin SDK initialised from {sa_path}")

bearer = HTTPBearer()


def verify_token(
    creds: HTTPAuthorizationCredentials = Security(bearer),
) -> dict:
    """
    FastAPI dependency — verify a Firebase ID token.

    Extracts the Bearer token from the Authorization header,
    verifies it with Firebase Admin SDK, and returns the decoded payload.

    Raises:
        HTTPException(401) if the token is missing, expired, or invalid.
    """
    try:
        decoded = auth.verify_id_token(creds.credentials)
        return decoded
    except Exception as e:
        logger.warning(f"Token verification failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid or expired token")
