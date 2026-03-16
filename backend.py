import os
import urllib.request
import numpy
import cv2
import logging
import time as time_module
from datetime import datetime, date, time
import face_recognition
import requests
from email_reporter import validate_gmail_credentials

# Configure logging
logger = logging.getLogger(__name__)

# Constants
FACE_RECOGNITION_TOLERANCE = 0.45
FACE_DETECTION_SCALE_FACTOR = 0.25
MIN_WORK_HOURS = 4
LATE_AFTER_TIME = time(9, 30)  # 9:30 AM
# Default minimum departure time (e.g., end of workday)
MIN_DEPARTURE_TIME = time(17, 0)  # 5:00 PM
FIREBASE_AUTH_BASE_URL = "https://identitytoolkit.googleapis.com/v1/accounts"


class AttendanceBackend:
    """Backend class for managing employee attendance and face recognition."""
    
    def __init__(self, db_path="attendance.db", image_dir="Employee_Images"):
        """
        Initialize the attendance backend.
        
        Args:
            db_path: Path to the SQLite database file
            image_dir: Directory to store employee images
        """
        self.db_path = db_path
        self.image_dir = image_dir

        try:
            from api.database import get_conn
            self.conn = get_conn()
            self.conn.autocommit = False
            self.cur = self.conn.cursor()

            self._create_tables()
            self._ensure_owner_email_column()
            self._ensure_employees_owner_id_column()
            self._cleanup_old_years()
            # Load persisted settings (overrides defaults) before loading faces
            self._load_settings()
            self._load_faces()
            logger.info("Attendance backend initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize backend: {e}", exc_info=True)
            raise
    
    def close(self):
        """Close database connection."""
        try:
            if hasattr(self, 'conn') and self.conn:
                self.conn.close()
                logger.info("Database connection closed")
        except Exception as e:
            logger.error(f"Error closing database: {e}", exc_info=True)

    # --------------------------------------------------
    # DATABASE SETUP
    # --------------------------------------------------
    def _create_tables(self):
        """Create database tables if they don't exist."""
        try:
            # Owner table for authentication
            self.cur.execute("""
            CREATE TABLE IF NOT EXISTS owner (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE,
                password TEXT,
                email TEXT,
                image_path TEXT,
                created_at TEXT
            )
            """)

            self.cur.execute("""
            CREATE TABLE IF NOT EXISTS employees (
                id SERIAL PRIMARY KEY,
                owner_id INTEGER REFERENCES owner(id) ON DELETE CASCADE,
                name TEXT,
                role TEXT,
                image_path TEXT,
                UNIQUE(owner_id, name)
            )
            """)

            # Table for multiple images per employee
            self.cur.execute("""
            CREATE TABLE IF NOT EXISTS employee_images (
                id SERIAL PRIMARY KEY,
                employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
                image_path TEXT,
                blob_name TEXT,
                created_at TEXT
            )
            """)

            self.cur.execute("""
            CREATE TABLE IF NOT EXISTS attendance (
                id SERIAL PRIMARY KEY,
                employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
                date TEXT,
                entry_time TEXT,
                exit_time TEXT
            )
            """)
            # Settings table to persist configurable thresholds
            self.cur.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
            """)
            # Performance indexes (ignored if already exist)
            self.cur.execute("CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)")
            self.cur.execute("CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance(employee_id, date)")
            self.conn.commit()
            logger.info("Database tables created/verified")
        except Exception as e:
            logger.error(f"Error creating tables: {e}", exc_info=True)
            raise

    def _ensure_owner_email_column(self):
        """Ensure the owner table has an email column (PostgreSQL version)."""
        try:
            self.cur.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name='owner' AND column_name='email'
            """)
            if not self.cur.fetchone():
                self.cur.execute("ALTER TABLE owner ADD COLUMN email TEXT")
                self.conn.commit()
                logger.info("Added owner.email column to existing database")
        except Exception as e:
            logger.error(f"Error ensuring owner.email column: {e}", exc_info=True)
            raise

    def _ensure_employees_owner_id_column(self):
        """Add owner_id column to employees table for multi-tenant support."""
        try:
            self.cur.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name='employees' AND column_name='owner_id'
            """)
            if not self.cur.fetchone():
                # Get the first (and typically only) owner ID
                self.cur.execute("SELECT id FROM owner LIMIT 1")
                owner_row = self.cur.fetchone()
                owner_id = owner_row[0] if owner_row else 1
                
                # Add owner_id column with default value
                self.cur.execute(f"ALTER TABLE employees ADD COLUMN owner_id INTEGER DEFAULT {owner_id}")
                
                # Add foreign key constraint
                self.cur.execute("""
                    ALTER TABLE employees 
                    ADD CONSTRAINT fk_employees_owner 
                    FOREIGN KEY (owner_id) REFERENCES owner(id) ON DELETE CASCADE
                """)
                
                # Recreate unique constraint to include owner_id
                try:
                    self.cur.execute("ALTER TABLE employees DROP CONSTRAINT employees_name_key")
                except:
                    pass  # Constraint might not exist
                
                self.cur.execute("""
                    ALTER TABLE employees 
                    ADD CONSTRAINT employees_owner_name_unique UNIQUE(owner_id, name)
                """)
                
                self.conn.commit()
                logger.info("Added employees.owner_id column for multi-tenant support")
        except Exception as e:
            logger.error(f"Error ensuring employees.owner_id column: {e}", exc_info=True)
            self.conn.rollback()

    def _cleanup_old_years(self):
        """Remove attendance records from previous years."""
        try:
            current_year = datetime.now().year
            self.cur.execute("""
            DELETE FROM attendance
            WHERE substr(date, 1, 4) < %s
            """, (str(current_year),))
            deleted_count = self.cur.rowcount
            self.conn.commit()
            if deleted_count > 0:
                logger.info(f"Cleaned up {deleted_count} old attendance records")
        except Exception as e:
            logger.error(f"Error cleaning up old records: {e}", exc_info=True)

    # --------------------------------------------------
    # EMPLOYEES
    # --------------------------------------------------
    def register_employee(self, name, role, frame, add_image=False, owner_id=None):
        """
        Register a new employee or add image to existing employee.
        
        Args:
            name: Employee name
            role: Employee role
            frame: OpenCV frame containing employee face
            add_image: If True and employee exists, add this image instead of replacing
            owner_id: Owner ID for multi-tenant support (required for new employees)
            
        Raises:
            ValueError: If name or role is invalid
            IOError: If image cannot be saved
        """
        if not name or not name.strip():
            raise ValueError("Employee name cannot be empty")
        if not role or not role.strip():
            raise ValueError("Employee role cannot be empty")
        
        name = name.strip()
        role = role.strip()
        
        try:
            # Check if employee exists for this owner
            if owner_id:
                self.cur.execute("SELECT id FROM employees WHERE owner_id=%s AND name=%s", (owner_id, name))
            else:
                self.cur.execute("SELECT id FROM employees WHERE name=%s", (name,))
            emp_row = self.cur.fetchone()
            
            from api.storage import upload_face_image
            # Encode frame to JPEG bytes and upload to Firebase Storage
            ok, buf = cv2.imencode(".jpg", frame)
            if not ok:
                raise IOError("Failed to encode frame as JPEG")
            img_url, blob_name = upload_face_image(name, buf.tobytes())

            if emp_row:
                # Employee exists
                emp_id = emp_row[0]
                if add_image:
                    # Add new image to employee_images table
                    self.cur.execute("""
                    INSERT INTO employee_images (employee_id, image_path, blob_name, created_at)
                    VALUES (%s, %s, %s, %s)
                    """, (emp_id, img_url, blob_name, datetime.now().isoformat()))
                    logger.info(f"Added image to employee: {name}")
                else:
                    # Update role and main image_path
                    self.cur.execute("""
                    UPDATE employees SET role=%s, image_path=%s WHERE id=%s
                    """, (role, img_url, emp_id))
                    # Also add to employee_images
                    self.cur.execute("""
                    INSERT INTO employee_images (employee_id, image_path, blob_name, created_at)
                    VALUES (%s, %s, %s, %s)
                    """, (emp_id, img_url, blob_name, datetime.now().isoformat()))
                    logger.info(f"Updated employee: {name} ({role})")
            else:
                # New employee
                if not owner_id:
                    raise ValueError("owner_id is required for new employees")
                self.cur.execute("""
                INSERT INTO employees (owner_id, name, role, image_path)
                VALUES (%s, %s, %s, %s)
                """, (owner_id, name, role, img_url))
                # psycopg2: use RETURNING id instead of lastrowid
                self.cur.execute("SELECT id FROM employees WHERE owner_id=%s AND name=%s", (owner_id, name))
                emp_id = self.cur.fetchone()[0]
                self.cur.execute("""
                INSERT INTO employee_images (employee_id, image_path, blob_name, created_at)
                VALUES (%s, %s, %s, %s)
                """, (emp_id, img_url, blob_name, datetime.now().isoformat()))
                logger.info(f"Registered new employee: {name} ({role})")

            self.conn.commit()
            self._load_faces()
        except Exception as e:
            logger.error(f"Error registering employee {name}: {e}", exc_info=True)
            self.conn.rollback()
            raise

    def add_employee_image(self, name, frame):
        """
        Add an additional image to an existing employee.
        
        Args:
            name: Employee name
            frame: OpenCV frame containing employee face
            
        Returns:
            bool: True if image added successfully
        """
        try:
            # Get employee role to pass to register_employee
            self.cur.execute("SELECT role FROM employees WHERE name=%s", (name,))
            emp_row = self.cur.fetchone()
            if not emp_row:
                raise ValueError(f"Employee '{name}' not found")
            
            role = emp_row[0]
            self.register_employee(name, role, frame, add_image=True)
            return True
        except Exception as e:
            logger.error(f"Error adding image to employee {name}: {e}", exc_info=True)
            return False

    def get_employee_images(self, name):
        """
        Get all image paths for an employee.
        
        Args:
            name: Employee name
            
        Returns:
            List of image paths
        """
        try:
            self.cur.execute("SELECT id FROM employees WHERE name=%s", (name,))
            emp_row = self.cur.fetchone()
            if not emp_row:
                return []
            
            emp_id = emp_row[0]
            self.cur.execute("""
                SELECT image_path FROM employee_images 
                WHERE employee_id = %s
                ORDER BY created_at
            """, (emp_id,))
            return [row[0] for row in self.cur.fetchall()]
        except Exception as e:
            logger.error(f"Error getting employee images: {e}", exc_info=True)
            return []

    def update_employee(self, old_name, new_name, new_role, frame=None):
        """
        Update an existing employee's details and optionally their photo.
        
        Args:
            old_name: Current name of the employee in the database
            new_name: New name to set
            new_role: New role to set
            frame: Optional OpenCV frame with a new photo. If None, keep/rename existing image.
        """
        if not old_name or not old_name.strip():
            raise ValueError("Old employee name cannot be empty")
        if not new_name or not new_name.strip():
            raise ValueError("New employee name cannot be empty")
        if not new_role or not new_role.strip():
            raise ValueError("Employee role cannot be empty")

        old_name = old_name.strip()
        new_name = new_name.strip()
        new_role = new_role.strip()

        try:
            # Find existing employee
            self.cur.execute(
                "SELECT id, image_path FROM employees WHERE name=%s",
                (old_name,),
            )
            row = self.cur.fetchone()
            if not row:
                # If employee not found, fall back to registering as new
                logger.warning(f"Employee '{old_name}' not found, registering new employee instead")
                if frame is None:
                    raise ValueError("Cannot register new employee without a photo")
                return self.register_employee(new_name, new_role, frame)

            emp_id, old_image_path = row

            safe_new_name = new_name.replace(" ", "_")
            safe_new_role = new_role.replace(" ", "_")
            new_image_path = old_image_path

            # If we have a new frame, upload to Firebase Storage
            if frame is not None:
                from api.storage import upload_face_image, delete_face_image
                ok, buf = cv2.imencode(".jpg", frame)
                if not ok:
                    raise IOError("Failed to encode frame as JPEG")
                # Delete old image from Firebase Storage (best-effort)
                if old_image_path and old_image_path.startswith("https://"):
                    # Retrieve blob_name from employee_images
                    self.cur.execute("""
                        SELECT blob_name FROM employee_images
                        WHERE employee_id=%s ORDER BY created_at DESC LIMIT 1
                    """, (emp_id,))
                    bn_row = self.cur.fetchone()
                    if bn_row and bn_row[0]:
                        delete_face_image(bn_row[0])
                new_image_path, _blob = upload_face_image(new_name, buf.tobytes())
            else:
                # No new frame — keep existing URL as-is, just update name/role in DB
                new_image_path = old_image_path

            # Update employee record (keeps same ID so attendance is preserved)
            self.cur.execute(
                """
                UPDATE employees
                SET name = %s, role = %s, image_path = %s
                WHERE id = %s
                """,
                (new_name, new_role, new_image_path, emp_id),
            )
            self.conn.commit()

            self._load_faces()
            logger.info(f"Updated employee '{old_name}' -> '{new_name}' ({new_role})")
        except Exception as e:
            logger.error(f"Error updating employee {old_name}: {e}", exc_info=True)
            self.conn.rollback()
            raise

    def delete_employee(self, name):
        """
        Delete an employee and their associated data.
        
        Args:
            name: Employee name to delete
        """
        if not name:
            return
        
        try:
            # Delete all Firebase Storage images for this employee
            from api.storage import delete_face_image
            self.cur.execute("SELECT id FROM employees WHERE name=%s", (name,))
            emp_row = self.cur.fetchone()
            if emp_row:
                self.cur.execute(
                    "SELECT blob_name FROM employee_images WHERE employee_id=%s",
                    (emp_row[0],)
                )
                for img_row in self.cur.fetchall():
                    if img_row[0]:
                        delete_face_image(img_row[0])

            self.cur.execute("DELETE FROM employees WHERE name=%s", (name,))
            self.conn.commit()
            self._load_faces()
            logger.info(f"Deleted employee: {name}")
        except Exception as e:
            logger.error(f"Error deleting employee {name}: {e}", exc_info=True)
            self.conn.rollback()
            raise

    def get_employee_list(self, owner_id=None):
        """
        Get list of all employees, optionally filtered by owner.
        
        Args:
            owner_id: Optional owner ID to filter employees
            
        Returns:
            List of tuples (name, role)
        """
        try:
            if owner_id:
                self.cur.execute("SELECT name, role FROM employees WHERE owner_id=%s ORDER BY name", (owner_id,))
            else:
                self.cur.execute("SELECT name, role FROM employees ORDER BY name")
            return self.cur.fetchall()
        except Exception as e:
            logger.error(f"Error getting employee list: {e}", exc_info=True)
            return []

    # --------------------------------------------------
    # FACE RECOGNITION
    # --------------------------------------------------
    def _load_faces(self):
        """Load face encodings for all registered employees (supports multiple images per employee)."""
        self.known_encodings = []
        self.known_names = []

        try:
            # Get all employees
            self.cur.execute("SELECT id, name FROM employees")
            employees = self.cur.fetchall()
            loaded_count = 0
            
            for emp_id, name in employees:
                # Get all images for this employee
                self.cur.execute("""
                    SELECT image_path FROM employee_images 
                    WHERE employee_id = %s
                    ORDER BY created_at
                """, (emp_id,))
                image_paths = [row[0] for row in self.cur.fetchall()]
                
                # Fallback to legacy single image_path if no images in employee_images table
                if not image_paths:
                    self.cur.execute("SELECT image_path FROM employees WHERE id = %s", (emp_id,))
                    legacy_path = self.cur.fetchone()
                    if legacy_path and legacy_path[0]:
                        image_paths = [legacy_path[0]]
                
                # Load encodings from all images (downloaded from Firebase Storage URLs)
                for path in image_paths:
                    if not path or not path.startswith("https://"):
                        logger.warning(f"Skipping invalid image URL for {name}: {path}")
                        continue
                    try:
                        resp = requests.get(path, timeout=10)
                        resp.raise_for_status()
                        arr = numpy.frombuffer(resp.content, numpy.uint8)
                        img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                        if img_bgr is None:
                            logger.warning(f"Could not decode image for {name}: {path}")
                            continue
                        img = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
                        enc = face_recognition.face_encodings(img)
                        if enc:
                            self.known_encodings.append(enc[0])
                            self.known_names.append(name)
                            loaded_count += 1
                        else:
                            logger.warning(f"No face found in image for {name}: {path}")
                    except Exception as e:
                        logger.error(f"Error loading face encoding for {name}: {e}", exc_info=True)
            
            logger.info(f"Loaded {loaded_count} face encodings from {len(employees)} employees")
        except Exception as e:
            logger.error(f"Error loading faces: {e}", exc_info=True)

    # --------------------------------------------------
    # SETTINGS
    # --------------------------------------------------
    def _load_settings(self):
        """Load persisted settings from the database and set instance attributes."""
        try:
            # Defaults
            self.min_work_hours = MIN_WORK_HOURS
            self.late_after_time = LATE_AFTER_TIME
            self.min_departure_time = MIN_DEPARTURE_TIME

            # Read settings table
            self.cur.execute("SELECT key, value FROM settings")
            for key, value in self.cur.fetchall():
                if key == 'min_work_hours':
                    try:
                        self.min_work_hours = float(value)
                    except Exception:
                        logger.warning(f"Invalid min_work_hours in settings: {value}")
                elif key == 'late_after_time':
                    # stored as HH:MM or HH:MM:SS
                    try:
                        parts = value.split(":")
                        h = int(parts[0]); m = int(parts[1])
                        s = int(parts[2]) if len(parts) > 2 else 0
                        self.late_after_time = time(h, m, s)
                    except Exception:
                        logger.warning(f"Invalid late_after_time in settings: {value}")
                elif key == 'min_departure_time':
                    try:
                        parts = value.split(":")
                        h = int(parts[0]); m = int(parts[1])
                        s = int(parts[2]) if len(parts) > 2 else 0
                        self.min_departure_time = time(h, m, s)
                    except Exception:
                        logger.warning(f"Invalid min_departure_time in settings: {value}")

            logger.info(f"Loaded settings: min_work_hours={self.min_work_hours}, late_after_time={self.late_after_time}, min_departure_time={self.min_departure_time}")
        except Exception as e:
            logger.error(f"Error loading settings: {e}", exc_info=True)

    def get_setting(self, key, default=None):
        try:
            self.cur.execute("SELECT value FROM settings WHERE key=%s", (key,))
            row = self.cur.fetchone()
            return row[0] if row else default
        except Exception as e:
            logger.error(f"Error getting setting {key}: {e}", exc_info=True)
            return default

    def set_setting(self, key, value):
        try:
            self.cur.execute("""
                INSERT INTO settings (key, value) VALUES (%s, %s)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """, (key, str(value)))
            self.conn.commit()
            # reload in-memory settings
            self._load_settings()
            return True
        except Exception as e:
            logger.error(f"Error setting {key}={value}: {e}", exc_info=True)
            self.conn.rollback()
            return False

    # --------------------------------------------------
    # OWNER AUTHENTICATION
    # --------------------------------------------------
    def _resolve_firebase_api_key(self, api_key=None):
        """Resolve Firebase API key from arg, env, or settings."""
        key = (api_key or "").strip()
        if key:
            return key
        env_key = os.getenv("FIREBASE_API_KEY", "").strip()
        if env_key:
            return env_key
        return (self.get_setting("firebase_api_key", "") or "").strip()

    def _firebase_error_message(self, code):
        """Map Firebase error code to a user-friendly message."""
        mapping = {
            "EMAIL_EXISTS": "This email is already registered.",
            "INVALID_EMAIL": "Invalid email address format.",
            "MISSING_PASSWORD": "Password is required.",
            "WEAK_PASSWORD : Password should be at least 6 characters": "Password must be at least 6 characters.",
            "WEAK_PASSWORD": "Password must be at least 6 characters.",
            "INVALID_PASSWORD": "Incorrect password.",
            "EMAIL_NOT_FOUND": "No account found for this email.",
            "INVALID_LOGIN_CREDENTIALS": "Invalid email or password.",
            "OPERATION_NOT_ALLOWED": "Email/password sign-in is not enabled in Firebase project.",
        }
        return mapping.get(code, f"Firebase error: {code}")

    def _firebase_auth_request(self, action, payload, api_key):
        """Call Firebase Identity Toolkit auth endpoint and return (ok, data_or_error_code)."""
        if not api_key:
            return False, "MISSING_API_KEY"

        url = f"{FIREBASE_AUTH_BASE_URL}:{action}?key={api_key}"
        try:
            response = requests.post(url, json=payload, timeout=20)
            data = response.json() if response.text else {}
        except requests.RequestException as e:
            logger.error(f"Firebase request error ({action}): {e}")
            return False, "NETWORK_ERROR"
        except Exception as e:
            logger.error(f"Firebase parse error ({action}): {e}", exc_info=True)
            return False, "INVALID_RESPONSE"

        if response.ok and "error" not in data:
            return True, data

        err_code = (
            data.get("error", {}).get("message")
            if isinstance(data, dict) else None
        ) or f"HTTP_{response.status_code}"
        logger.warning(f"Firebase auth failed ({action}): {err_code}")
        return False, err_code
    def owner_exists(self):
        """Check if owner is registered."""
        try:
            self.cur.execute("SELECT COUNT(*) FROM owner")
            count = self.cur.fetchone()[0]
            return count > 0
        except Exception as e:
            logger.error(f"Error checking owner existence: {e}", exc_info=True)
            return False

    def register_owner(self, name, password, frame=None, owner_email=None, firebase_api_key=None):
        """
        Register the owner using Firebase email/password authentication.
        
        Args:
            name: Owner name
            password: Owner password (Firebase auth password)
            frame: Legacy argument (unused)
            owner_email: Owner email used for Firebase auth
            firebase_api_key: Firebase Web API key
            
        Raises:
            ValueError: If owner already exists or invalid input
        """
        if not name or not name.strip():
            raise ValueError("Owner name cannot be empty")
        if not owner_email or "@" not in owner_email:
            raise ValueError("Owner email is required")
        if not password or len(password.strip()) < 6:
            raise ValueError("Owner password must be at least 6 characters")
        
        name = name.strip()
        password = (password or "").strip()
        owner_email = (owner_email or "").strip().lower()
        firebase_api_key = self._resolve_firebase_api_key(firebase_api_key)

        if not firebase_api_key:
            raise ValueError("Firebase API key is required")
        
        try:
            self.cur.execute("SELECT id FROM owner LIMIT 1")
            existing_owner = self.cur.fetchone()
            signup_payload = {
                "email": owner_email,
                "password": password,
                "returnSecureToken": True
            }
            ok, signup_res = self._firebase_auth_request(
                "signUp", signup_payload, firebase_api_key
            )
            if not ok:
                # If already registered in Firebase, verify password by signing in.
                if signup_res == "EMAIL_EXISTS":
                    signin_payload = {
                        "email": owner_email,
                        "password": password,
                        "returnSecureToken": True
                    }
                    ok_signin, signin_res = self._firebase_auth_request(
                        "signInWithPassword", signin_payload, firebase_api_key
                    )
                    if not ok_signin:
                        raise ValueError(
                            f"Owner email already exists in Firebase, and sign-in failed: "
                            f"{self._firebase_error_message(signin_res)}"
                        )
                else:
                    raise ValueError(self._firebase_error_message(signup_res))

            self.set_setting("firebase_api_key", firebase_api_key)
            if existing_owner:
                self.cur.execute(
                    """
                    UPDATE owner
                    SET name=%s, password=%s, email=%s
                    WHERE id=%s
                    """,
                    (name, "", owner_email, existing_owner[0])
                )
            else:
                self.cur.execute("""
                INSERT INTO owner (name, password, email, image_path, created_at)
                VALUES (%s, %s, %s, %s, %s)
                """, (name, "", owner_email, "", datetime.now().isoformat()))
            self.conn.commit()
            
            logger.info(f"Owner Firebase auth configured: {name}")
        except Exception as e:
            logger.error(f"Error registering owner: {e}", exc_info=True)
            self.conn.rollback()
            raise

    def register_owner_firebase(self, email, organization_name, firebase_uid):
        """
        Register a new owner/organization via Firebase authentication.
        This is called when a new user signs up through the signup page.
        
        Args:
            email: Owner email (already verified by Firebase)
            organization_name: Name of the organization
            firebase_uid: Firebase unique identifier for the owner
            
        Returns:
            dict: Success/error response
        """
        try:
            # Check if owner with this email already exists
            self.cur.execute("SELECT id FROM owner WHERE email = %s", (email.lower(),))
            existing = self.cur.fetchone()
            
            if existing:
                logger.warning(f"Owner with email {email} already registered")
                return {"status": "success", "message": "Owner account already exists"}
            
            # Insert new owner record
            self.cur.execute("""
                INSERT INTO owner (name, email, password, image_path, created_at, firebase_uid)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                organization_name,
                email.lower(),
                "",  # Password is handled by Firebase
                "",  # No face image for now
                datetime.now().isoformat(),
                firebase_uid
            ))
            
            # Also store in settings for backward compatibility if needed
            self.set_setting(f"owner_firebase_uid_{email}", firebase_uid)
            
            self.conn.commit()
            logger.info(f"Owner registered via Firebase: {organization_name} ({email})")
            
            return {
                "status": "success",
                "message": f"Owner {organization_name} registered successfully"
            }
        except Exception as e:
            logger.error(f"Error registering owner via Firebase: {e}", exc_info=True)
            self.conn.rollback()
            raise

    def authenticate_owner(self, frame):
        """
        Authenticate owner using face recognition.
        
        Args:
            frame: OpenCV frame containing face to authenticate
            
        Returns:
            bool: True if authentication successful, False otherwise
        """
        try:
            # Load owner face encoding from image file (more reliable)
            self.cur.execute("SELECT image_path FROM owner")
            row = self.cur.fetchone()
            if not row:
                return False
            
            img_path = row[0]
            if not os.path.exists(img_path):
                logger.warning(f"Owner image not found: {img_path}")
                return False
            
            # Load stored face encoding
            stored_img = face_recognition.load_image_file(img_path)
            stored_encodings = face_recognition.face_encodings(stored_img)
            if not stored_encodings:
                logger.warning("No face found in owner image")
                return False
            
            stored_encoding = stored_encodings[0]
            
            # Extract face from current frame
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            face_encodings = face_recognition.face_encodings(rgb_frame)
            if not face_encodings:
                return False
            
            # Compare faces
            matches = face_recognition.compare_faces(
                [stored_encoding], 
                face_encodings[0], 
                tolerance=FACE_RECOGNITION_TOLERANCE
            )
            
            return matches[0] if matches else False
        except Exception as e:
            logger.error(f"Error authenticating owner: {e}", exc_info=True)
            return False

    def get_owner_email(self):
        """Return stored owner email if present."""
        try:
            self.cur.execute("SELECT email FROM owner LIMIT 1")
            row = self.cur.fetchone()
            return (row[0] or "").strip().lower() if row else ""
        except Exception as e:
            logger.error(f"Error getting owner email: {e}", exc_info=True)
            return ""

    def get_owner_name(self):
        """Return stored owner name if present."""
        try:
            self.cur.execute("SELECT name FROM owner LIMIT 1")
            row = self.cur.fetchone()
            return (row[0] or "").strip() if row else ""
        except Exception as e:
            logger.error(f"Error getting owner name: {e}", exc_info=True)
            return ""

    def get_owner_id_from_firebase_uid(self, firebase_uid: str) -> int:
        """Get owner ID from Firebase UID (used for multi-tenant lookups)."""
        try:
            self.cur.execute("""
                SELECT id FROM owner 
                WHERE firebase_uid = %s
            """, (firebase_uid,))
            row = self.cur.fetchone()
            return row[0] if row else None
        except Exception as e:
            logger.error(f"Error getting owner ID from Firebase UID: {e}", exc_info=True)
            return None

    def validate_gmail_credentials(self, email, app_password):
        """Validate Gmail login details using SMTP."""
        try:
            return validate_gmail_credentials(email, app_password)
        except Exception:
            return False

    def authenticate_owner_gmail(self, email, app_password):
        """
        Authenticate owner using Gmail credentials.

        If owner email is not set (legacy data), first successful login will bind the email.
        """
        try:
            email = (email or "").strip().lower()
            app_password = (app_password or "").strip()
            if not email or not app_password:
                return False
            if "@gmail.com" not in email:
                return False

            self.cur.execute("SELECT id, email FROM owner LIMIT 1")
            row = self.cur.fetchone()
            if not row:
                return False

            owner_id, saved_email = row[0], (row[1] or "").strip().lower()
            if saved_email and saved_email != email:
                return False

            if not validate_gmail_credentials(email, app_password):
                return False

            if not saved_email:
                self.cur.execute("UPDATE owner SET email=%s WHERE id=%s", (email, owner_id))
                self.conn.commit()
            return True
        except Exception as e:
            logger.error(f"Error authenticating owner Gmail: {e}", exc_info=True)
            return False

    def authenticate_owner_password(self, password):
        """
        Authenticate owner password against Firebase.
        
        Args:
            password: Password to check
            
        Returns:
            bool: True if password matches, False otherwise
        """
        ok, _ = self.verify_owner_password(password)
        return ok

    def verify_owner_password(self, password):
        """
        Verify owner password against Firebase using stored owner email.

        Returns:
            (bool, str): success flag and failure reason (if any)
        """
        try:
            if not password:
                return False, "Password is required"

            self.cur.execute("SELECT email FROM owner LIMIT 1")
            row = self.cur.fetchone()
            if not row:
                return False, "Owner account is not registered"

            owner_email = (row[0] or "").strip().lower()
            if not owner_email:
                return False, "Owner setup is incomplete. Complete owner setup to continue."

            firebase_api_key = self._resolve_firebase_api_key()
            if not firebase_api_key:
                return False, "Firebase API key is missing. Complete owner setup or update Settings."

            payload = {
                "email": owner_email,
                "password": password.strip(),
                "returnSecureToken": True
            }
            ok, result = self._firebase_auth_request(
                "signInWithPassword",
                payload,
                firebase_api_key
            )
            if not ok:
                return False, self._firebase_error_message(result)
            return True, ""
        except Exception as e:
            logger.error(f"Error authenticating owner password: {e}", exc_info=True)
            return False, "Authentication failed due to an internal error"

    def delete_owner(self):
        """
        Delete all owner information including database record and image file.
        
        Returns:
            bool: True if owner deleted successfully, False otherwise
        """
        try:
            # Get owner image path before deleting
            self.cur.execute("SELECT image_path FROM owner")
            row = self.cur.fetchone()
            
            # Delete owner image file if it exists
            if row and row[0] and os.path.exists(row[0]):
                try:
                    os.remove(row[0])
                    logger.info(f"Deleted owner image: {row[0]}")
                except OSError as e:
                    logger.warning(f"Could not delete owner image {row[0]}: {e}")
            
            # Delete owner record from database
            self.cur.execute("DELETE FROM owner")
            self.conn.commit()
            
            logger.info("Owner information deleted successfully")
            return True
        except Exception as e:
            logger.error(f"Error deleting owner: {e}", exc_info=True)
            self.conn.rollback()
            return False

    def recognize_faces(self, frame):
        """
        Recognize faces in a frame.
        
        Args:
            frame: OpenCV BGR frame
            
        Returns:
            List of recognized employee names
        """
        if not self.known_encodings:
            return []

        try:
            small = cv2.resize(frame, (0, 0), fx=FACE_DETECTION_SCALE_FACTOR, fy=FACE_DETECTION_SCALE_FACTOR)
            rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)

            locs = face_recognition.face_locations(rgb)
            encs = face_recognition.face_encodings(rgb, locs)

            detected = set()
            for e in encs:
                matches = face_recognition.compare_faces(
                    self.known_encodings, e, tolerance=FACE_RECOGNITION_TOLERANCE
                )
                if True in matches:
                    detected.add(self.known_names[matches.index(True)])

            return list(detected)
        except Exception as e:
            logger.error(f"Error recognizing faces: {e}", exc_info=True)
            return []

    # --------------------------------------------------
    # ATTENDANCE CORE
    # --------------------------------------------------
    def _today(self):
        return date.today().isoformat()  # YYYY-MM-DD

    def _now(self):
        return datetime.now().strftime("%H:%M:%S")

    def mark_entry(self, name):
        """
        Mark entry attendance for an employee.
        
        Args:
            name: Employee name
            
        Returns:
            bool: True if entry was marked, False otherwise
        """
        if not name:
            return False
        
        try:
            today = self._today()

            self.cur.execute("""
            SELECT id FROM employees WHERE name=%s
            """, (name,))
            emp = self.cur.fetchone()
            if not emp:
                logger.warning(f"Employee not found: {name}")
                return False

            emp_id = emp[0]

            self.cur.execute("""
            SELECT id FROM attendance
            WHERE employee_id=%s AND date=%s
            """, (emp_id, today))

            if self.cur.fetchone():
                logger.info(f"Entry already marked for {name} today")
                return False  # already entered today

            self.cur.execute("""
            INSERT INTO attendance (employee_id, date, entry_time)
            VALUES (%s, %s, %s)
            """, (emp_id, today, self._now()))
            self.conn.commit()
            logger.info(f"Marked entry for {name} at {self._now()}")
            return True
        except Exception as e:
            logger.error(f"Error marking entry for {name}: {e}", exc_info=True)
            self.conn.rollback()
            return False

    def mark_exit(self, name):
        """
        Mark exit attendance for an employee.
        
        Args:
            name: Employee name
            
        Returns:
            bool: True if exit was marked, False otherwise
        """
        if not name:
            return False
        
        try:
            today = self._today()

            self.cur.execute("""
            SELECT id FROM employees WHERE name=%s
            """, (name,))
            emp = self.cur.fetchone()
            if not emp:
                logger.warning(f"Employee not found: {name}")
                return False

            emp_id = emp[0]

            self.cur.execute("""
            SELECT id FROM attendance
            WHERE employee_id=%s AND date=%s AND exit_time IS NULL
            """, (emp_id, today))

            row = self.cur.fetchone()
            if not row:
                logger.warning(f"No entry found for {name} today or exit already marked")
                return False

            self.cur.execute("""
            UPDATE attendance
            SET exit_time=%s
            WHERE id=%s
            """, (self._now(), row[0]))
            self.conn.commit()
            logger.info(f"Marked exit for {name} at {self._now()}")
            return True
        except Exception as e:
            logger.error(f"Error marking exit for {name}: {e}", exc_info=True)
            self.conn.rollback()
            return False

    # --------------------------------------------------
    # TODAY VIEW
    # --------------------------------------------------
    def get_today_attendance(self):
        """
        Get today's attendance records.
        
        Returns:
            List of tuples (name, role, entry_time, exit_time)
        """
        try:
            today = self._today()
            self.cur.execute("""
            SELECT e.name, e.role, a.entry_time, a.exit_time
            FROM attendance a
            JOIN employees e ON a.employee_id = e.id
            WHERE a.date=%s
            ORDER BY e.name
            """, (today,))
            return self.cur.fetchall()
        except Exception as e:
            logger.error(f"Error getting today's attendance: {e}", exc_info=True)
            return []

    # --------------------------------------------------
    # SEARCH
    # --------------------------------------------------
    def get_attendance_by_date(self, date_str):
        """
        Get attendance records for a specific date.
        
        Args:
            date_str: Date in YYYY-MM-DD format
            
        Returns:
            List of tuples (name, role, entry_time, exit_time)
        """
        try:
            self.cur.execute("""
            SELECT e.name, e.role, a.entry_time, a.exit_time
            FROM attendance a
            JOIN employees e ON a.employee_id = e.id
            WHERE a.date=%s
            ORDER BY e.name
            """, (date_str,))
            return self.cur.fetchall()
        except Exception as e:
            logger.error(f"Error getting attendance by date {date_str}: {e}", exc_info=True)
            return []

    def get_attendance_by_month(self, year, month):
        """
        Get attendance records for a specific month.
        
        Args:
            year: Year (e.g., 2024)
            month: Month (1-12)
            
        Returns:
            List of tuples (name, role, date, entry_time, exit_time)
        """
        try:
            ym = f"{year}-{month:02d}"
            self.cur.execute("""
            SELECT e.name, e.role, a.date, a.entry_time, a.exit_time
            FROM attendance a
            JOIN employees e ON a.employee_id = e.id
            WHERE substr(a.date,1,7)=%s
            ORDER BY a.date, e.name
            """, (ym,))
            return self.cur.fetchall()
        except Exception as e:
            logger.error(f"Error getting attendance by month {year}-{month:02d}: {e}", exc_info=True)
            return []

    # --------------------------------------------------
    # MONTHLY ANALYTICS
    # --------------------------------------------------
    def get_monthly_irregulars(self, year, month):
        """
        Get employees with irregular attendance for a given month.
        Irregular = absent for the day OR entry after 9:30 AM OR worked less than MIN_WORK_HOURS.
        
        Args:
            year: Year (e.g., 2024)
            month: Month (1-12)
            
        Returns:
            List of tuples (name, role, absent_days, late_days, irregular_dates)
            where irregular_dates is a comma-separated string of dates (YYYY-MM-DD).
        """
        try:
            records = self.get_attendance_by_month(year, month)
            stats = {}

            for name, role, d, entry, exit_ in records:
                if name not in stats:
                    stats[name] = {
                        "role": role,
                        "absent": 0,
                        "late": 0,
                        "low_hours": 0,
                        "dates": set(),
                    }

                is_irregular = False

                # Absent = no entry time recorded at all
                if not entry:
                    stats[name]["absent"] += 1
                    is_irregular = True
                else:
                    try:
                        entry_dt = datetime.strptime(entry, "%H:%M:%S").time()
                        if entry_dt > getattr(self, 'late_after_time', LATE_AFTER_TIME):
                            stats[name]["late"] += 1
                            is_irregular = True
                    except ValueError as e:
                        logger.warning(f"Invalid entry time format for {name} on {d}: {e}")

                # Low working hours check (only if both entry and exit are present)
                # Low working hours check (only if both entry and exit are present)
                if entry and exit_:
                    try:
                        t1 = datetime.strptime(entry, "%H:%M:%S")
                        t2 = datetime.strptime(exit_, "%H:%M:%S")
                        hours = (t2 - t1).seconds / 3600
                        min_hours = getattr(self, 'min_work_hours', MIN_WORK_HOURS)
                        if hours < min_hours:
                            stats[name]["low_hours"] += 1
                            is_irregular = True

                        # Additionally, flag if exit time is earlier than configured minimum departure time
                        try:
                            exit_dt = datetime.strptime(exit_, "%H:%M:%S").time()
                            min_departure = getattr(self, 'min_departure_time', MIN_DEPARTURE_TIME)
                            if exit_dt < min_departure:
                                # Count this as a low_hours-like irregularity
                                stats[name]["low_hours"] += 1
                                is_irregular = True
                        except ValueError:
                            # ignore malformed exit time
                            pass
                    except ValueError as e:
                        logger.warning(f"Invalid time format for {name} on {d}: {e}")

                if is_irregular:
                    stats[name]["dates"].add(d)

            return [
                (
                    name,
                    v["role"],
                    v["absent"],
                    v["late"],
                    ", ".join(sorted(v["dates"])),
                )
                for name, v in stats.items()
                if v["absent"] > 0 or v["late"] > 0 or v["low_hours"] > 0
            ]
        except Exception as e:
            logger.error(f"Error getting monthly irregulars: {e}", exc_info=True)
            return []
