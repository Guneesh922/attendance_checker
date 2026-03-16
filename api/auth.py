"""
api/auth.py
───────────
Firebase Admin SDK initialisation + ID token verification.

Every protected FastAPI route uses verify_token() as a Depends() dependency.

Environment variables required:
  FIREBASE_SERVICE_ACCOUNT_JSON — either a JSON string of the credentials OR a path to the file
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
    env_val = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "")
    
    # Try parsing as a raw JSON string first (for Railway)
    if env_val.strip().startswith("{"):
        import json
        cert_dict = json.loads(env_val)
        cred = credentials.Certificate(cert_dict)
        logger.info("Firebase Admin SDK initialised from JSON string in environment")
    else:
        # Fallback to parsing it as a file path (for local dev)
        cred = credentials.Certificate(env_val)
        logger.info(f"Firebase Admin SDK initialised from file path {env_val}")
        
    firebase_admin.initialize_app(cred)

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
