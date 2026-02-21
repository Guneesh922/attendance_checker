import os
import sqlite3
import cv2
import logging
import time as time_module
from datetime import datetime, date, time
import face_recognition

# Configure logging
logger = logging.getLogger(__name__)

# Constants
FACE_RECOGNITION_TOLERANCE = 0.45
FACE_DETECTION_SCALE_FACTOR = 0.25
MIN_WORK_HOURS = 4
LATE_AFTER_TIME = time(9, 30)  # 9:30 AM
# Default minimum departure time (e.g., end of workday)
MIN_DEPARTURE_TIME = time(17, 0)  # 5:00 PM


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
            if not os.path.exists(self.image_dir):
                os.makedirs(self.image_dir)
                logger.info(f"Created image directory: {self.image_dir}")

            self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
            self.cur = self.conn.cursor()

            self._create_tables()
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
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE,
                password TEXT,
                image_path TEXT,
                created_at TEXT
            )
            """)

            self.cur.execute("""
            CREATE TABLE IF NOT EXISTS employees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE,
                role TEXT,
                image_path TEXT
            )
            """)

            # Table for multiple images per employee
            self.cur.execute("""
            CREATE TABLE IF NOT EXISTS employee_images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                employee_id INTEGER,
                image_path TEXT,
                created_at TEXT,
                FOREIGN KEY (employee_id) REFERENCES employees(id)
            )
            """)

            self.cur.execute("""
            CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                employee_id INTEGER,
                date TEXT,
                entry_time TEXT,
                exit_time TEXT,
                FOREIGN KEY (employee_id) REFERENCES employees(id)
            )
            """)
            # Settings table to persist configurable thresholds
            self.cur.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
            """)
            self.conn.commit()
            logger.info("Database tables created/verified")
        except Exception as e:
            logger.error(f"Error creating tables: {e}", exc_info=True)
            raise

    def _cleanup_old_years(self):
        """Remove attendance records from previous years."""
        try:
            current_year = datetime.now().year
            self.cur.execute("""
            DELETE FROM attendance
            WHERE substr(date, 1, 4) < ?
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
    def register_employee(self, name, role, frame, add_image=False):
        """
        Register a new employee or add image to existing employee.
        
        Args:
            name: Employee name
            role: Employee role
            frame: OpenCV frame containing employee face
            add_image: If True and employee exists, add this image instead of replacing
            
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
            # Check if employee exists
            self.cur.execute("SELECT id FROM employees WHERE name=?", (name,))
            emp_row = self.cur.fetchone()
            
            safe_name = name.replace(" ", "_")
            safe_role = role.replace(" ", "_")
            
            # Generate unique image filename with timestamp if adding image
            if add_image and emp_row:
                timestamp = int(time_module.time())
                img_filename = f"{safe_name}_{safe_role}_{timestamp}.jpg"
            else:
                img_filename = f"{safe_name}_{safe_role}.jpg"
            
            img_path = os.path.join(self.image_dir, img_filename)

            if not cv2.imwrite(img_path, frame):
                raise IOError(f"Failed to save image to {img_path}")

            if emp_row:
                # Employee exists
                emp_id = emp_row[0]
                if add_image:
                    # Add new image to employee_images table
                    self.cur.execute("""
                    INSERT INTO employee_images (employee_id, image_path, created_at)
                    VALUES (?, ?, ?)
                    """, (emp_id, img_path, datetime.now().isoformat()))
                    logger.info(f"Added image to employee: {name}")
                else:
                    # Update role and main image_path (for backward compatibility)
                    self.cur.execute("""
                    UPDATE employees SET role=?, image_path=? WHERE id=?
                    """, (role, img_path, emp_id))
                    # Also add to employee_images if not already there
                    self.cur.execute("""
                    SELECT COUNT(*) FROM employee_images WHERE employee_id=? AND image_path=?
                    """, (emp_id, img_path))
                    if self.cur.fetchone()[0] == 0:
                        self.cur.execute("""
                        INSERT INTO employee_images (employee_id, image_path, created_at)
                        VALUES (?, ?, ?)
                        """, (emp_id, img_path, datetime.now().isoformat()))
                    logger.info(f"Updated employee: {name} ({role})")
            else:
                # New employee
                self.cur.execute("""
                INSERT INTO employees (name, role, image_path)
                VALUES (?, ?, ?)
                """, (name, role, img_path))
                emp_id = self.cur.lastrowid
                # Add to employee_images table
                self.cur.execute("""
                INSERT INTO employee_images (employee_id, image_path, created_at)
                VALUES (?, ?, ?)
                """, (emp_id, img_path, datetime.now().isoformat()))
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
            self.cur.execute("SELECT role FROM employees WHERE name=?", (name,))
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
            self.cur.execute("SELECT id FROM employees WHERE name=?", (name,))
            emp_row = self.cur.fetchone()
            if not emp_row:
                return []
            
            emp_id = emp_row[0]
            self.cur.execute("""
                SELECT image_path FROM employee_images 
                WHERE employee_id = ?
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
                "SELECT id, image_path FROM employees WHERE name=?",
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

            # If we have a new frame, save a new image
            if frame is not None:
                new_image_path = os.path.join(
                    self.image_dir,
                    f"{safe_new_name}_{safe_new_role}.jpg",
                )
                if not cv2.imwrite(new_image_path, frame):
                    raise IOError(f"Failed to save updated image to {new_image_path}")

                # Remove old image file if it's different
                if old_image_path and os.path.exists(old_image_path) and old_image_path != new_image_path:
                    try:
                        os.remove(old_image_path)
                        logger.info(f"Deleted old image: {old_image_path}")
                    except OSError as e:
                        logger.warning(f"Could not delete old image {old_image_path}: {e}")
            else:
                # No new frame: try to rename existing image file to match new name/role
                if old_image_path and os.path.exists(old_image_path):
                    target_image_path = os.path.join(
                        self.image_dir,
                        f"{safe_new_name}_{safe_new_role}.jpg",
                    )
                    if old_image_path != target_image_path:
                        try:
                            os.rename(old_image_path, target_image_path)
                            new_image_path = target_image_path
                            logger.info(f"Renamed image {old_image_path} -> {target_image_path}")
                        except OSError as e:
                            logger.warning(f"Could not rename image {old_image_path}: {e}")

            # Update employee record (keeps same ID so attendance is preserved)
            self.cur.execute(
                """
                UPDATE employees
                SET name = ?, role = ?, image_path = ?
                WHERE id = ?
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
            self.cur.execute("SELECT image_path FROM employees WHERE name=?", (name,))
            row = self.cur.fetchone()
            if row and os.path.exists(row[0]):
                try:
                    os.remove(row[0])
                    logger.info(f"Deleted image: {row[0]}")
                except OSError as e:
                    logger.warning(f"Could not delete image {row[0]}: {e}")

            self.cur.execute("DELETE FROM employees WHERE name=?", (name,))
            self.cur.execute("DELETE FROM attendance WHERE employee_id NOT IN (SELECT id FROM employees)")
            self.conn.commit()
            self._load_faces()
            logger.info(f"Deleted employee: {name}")
        except Exception as e:
            logger.error(f"Error deleting employee {name}: {e}", exc_info=True)
            self.conn.rollback()
            raise

    def get_employee_list(self):
        """
        Get list of all employees.
        
        Returns:
            List of tuples (name, role)
        """
        try:
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
                    WHERE employee_id = ?
                    ORDER BY created_at
                """, (emp_id,))
                image_paths = [row[0] for row in self.cur.fetchall()]
                
                # Fallback to legacy single image_path if no images in employee_images table
                if not image_paths:
                    self.cur.execute("SELECT image_path FROM employees WHERE id = ?", (emp_id,))
                    legacy_path = self.cur.fetchone()
                    if legacy_path and legacy_path[0]:
                        image_paths = [legacy_path[0]]
                
                # Load encodings from all images
                for path in image_paths:
                    if not os.path.exists(path):
                        logger.warning(f"Image not found for {name}: {path}")
                        continue
                    try:
                        img = face_recognition.load_image_file(path)
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
            self.cur.execute("SELECT value FROM settings WHERE key=?", (key,))
            row = self.cur.fetchone()
            return row[0] if row else default
        except Exception as e:
            logger.error(f"Error getting setting {key}: {e}", exc_info=True)
            return default

    def set_setting(self, key, value):
        try:
            self.cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, str(value)))
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
    def owner_exists(self):
        """Check if owner is registered."""
        try:
            self.cur.execute("SELECT COUNT(*) FROM owner")
            count = self.cur.fetchone()[0]
            return count > 0
        except Exception as e:
            logger.error(f"Error checking owner existence: {e}", exc_info=True)
            return False

    def register_owner(self, name, password, frame):
        """
        Register the owner with face recognition.
        
        Args:
            name: Owner name
            password: Owner password
            frame: OpenCV frame containing owner face
            
        Raises:
            ValueError: If owner already exists or invalid input
            IOError: If image cannot be saved
        """
        if not name or not name.strip():
            raise ValueError("Owner name cannot be empty")
        if not password or not password.strip():
            raise ValueError("Password cannot be empty")
        
        if self.owner_exists():
            raise ValueError("Owner already registered")
        
        name = name.strip()
        password = password.strip()
        
        try:
            # Save owner image
            owner_dir = "Owner_Images"
            if not os.path.exists(owner_dir):
                os.makedirs(owner_dir)
            
            img_path = os.path.join(owner_dir, f"{name.replace(' ', '_')}.jpg")
            if not cv2.imwrite(img_path, frame):
                raise IOError(f"Failed to save owner image to {img_path}")

            # Verify face is detected
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            encodings = face_recognition.face_encodings(rgb_frame)
            if not encodings:
                raise ValueError("No face detected in the image")
            
            # Store owner data
            self.cur.execute("""
            INSERT INTO owner (name, password, image_path, created_at)
            VALUES (?, ?, ?, ?)
            """, (name, password, img_path, datetime.now().isoformat()))
            self.conn.commit()
            
            logger.info(f"Owner registered: {name}")
        except Exception as e:
            logger.error(f"Error registering owner: {e}", exc_info=True)
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

    def authenticate_owner_password(self, password):
        """
        Authenticate owner using password.
        
        Args:
            password: Password to check
            
        Returns:
            bool: True if password matches, False otherwise
        """
        try:
            self.cur.execute("SELECT password FROM owner")
            row = self.cur.fetchone()
            if not row:
                return False
            return row[0] == password
        except Exception as e:
            logger.error(f"Error authenticating owner password: {e}", exc_info=True)
            return False

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
            SELECT id FROM employees WHERE name=?
            """, (name,))
            emp = self.cur.fetchone()
            if not emp:
                logger.warning(f"Employee not found: {name}")
                return False

            emp_id = emp[0]

            self.cur.execute("""
            SELECT id FROM attendance
            WHERE employee_id=? AND date=?
            """, (emp_id, today))

            if self.cur.fetchone():
                logger.info(f"Entry already marked for {name} today")
                return False  # already entered today

            self.cur.execute("""
            INSERT INTO attendance (employee_id, date, entry_time)
            VALUES (?, ?, ?)
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
            SELECT id FROM employees WHERE name=?
            """, (name,))
            emp = self.cur.fetchone()
            if not emp:
                logger.warning(f"Employee not found: {name}")
                return False

            emp_id = emp[0]

            self.cur.execute("""
            SELECT id FROM attendance
            WHERE employee_id=? AND date=? AND exit_time IS NULL
            """, (emp_id, today))

            row = self.cur.fetchone()
            if not row:
                logger.warning(f"No entry found for {name} today or exit already marked")
                return False

            self.cur.execute("""
            UPDATE attendance
            SET exit_time=?
            WHERE id=?
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
            WHERE a.date=?
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
            WHERE a.date=?
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
            WHERE substr(a.date,1,7)=?
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
