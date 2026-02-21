from datetime import datetime
import os
import time
import logging
import csv
import threading
import tkinter.filedialog as filedialog
import customtkinter as ctk
import cv2
from PIL import Image, ImageTk
import tkinter.messagebox as messagebox
from backend import AttendanceBackend
from email_reporter import send_email_report, build_email_report

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ── Camera constants ──────────────────────────────────────────────────────────
CAMERA_COOLDOWN_SECONDS     = 5
DIGITAL_ZOOM_FACTOR         = 1.5
CAMERA_UPDATE_INTERVAL_MS   = 30
CAMERA_STARTUP_DELAY_SECONDS = 1
VIDEO_DISPLAY_WIDTH         = 480
VIDEO_DISPLAY_HEIGHT        = 360
CAMERA_RESOLUTION_WIDTH     = 1280
CAMERA_RESOLUTION_HEIGHT    = 720

# ── Design tokens ─────────────────────────────────────────────────────────────
FONT_TITLE      = ("Roboto", 30, "bold")
FONT_HEADING    = ("Roboto", 22, "bold")
FONT_SUB        = ("Roboto", 15, "bold")
FONT_BODY       = ("Roboto", 13)
FONT_SMALL      = ("Roboto", 11)

C_PRIMARY   = "#5B6AF0"
C_PRIMARY_H = "#4A59DF"
C_SUCCESS   = "#10B981"
C_SUCCESS_H = "#059669"
C_WARNING   = "#F59E0B"
C_DANGER    = "#EF4444"
C_DANGER_H  = "#DC2626"
C_PURPLE    = "#7C3AED"
C_PURPLE_H  = "#6D28D9"
C_GRAY      = "#6B7280"
C_GRAY_H    = "#4B5563"

C_SURFACE   = "#181C2E"   # window background
C_CARD      = "#1E2235"   # primary card
C_CARD2     = "#252A3D"   # slightly lighter card
C_BORDER    = "#2E3450"
C_TEXT      = "#F1F5F9"
C_TEXT_DIM  = "#94A3B8"

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")


# ── Shared helpers ────────────────────────────────────────────────────────────
def card(parent, **kw):
    kw.setdefault("fg_color", C_CARD)
    kw.setdefault("corner_radius", 12)
    return ctk.CTkFrame(parent, **kw)


def btn(parent, text, cmd, color=C_PRIMARY, hover=C_PRIMARY_H, **kw):
    kw.setdefault("width", 180)
    kw.setdefault("height", 40)
    kw.setdefault("corner_radius", 8)
    kw.setdefault("font", FONT_BODY)
    return ctk.CTkButton(parent, text=text, command=cmd,
                         fg_color=color, hover_color=hover, **kw)


def success_toast(parent, message, duration=2000):
    """Auto-dismissing success notification."""
    t = ctk.CTkToplevel(parent)
    t.title("")
    t.geometry("320x100")
    t.resizable(False, False)
    t.grab_set()
    t.configure(fg_color=C_CARD)
    ctk.CTkFrame(t, height=4, fg_color=C_SUCCESS, corner_radius=0).pack(fill="x")
    ctk.CTkLabel(t, text="✅  " + message, font=FONT_BODY,
                 text_color=C_TEXT, wraplength=290).pack(expand=True)
    t.after(duration, t.destroy)


def error_dialog(parent, message):
    """Blocking error dialog."""
    t = ctk.CTkToplevel(parent)
    t.title("Error")
    t.geometry("360x160")
    t.resizable(False, False)
    t.grab_set()
    t.configure(fg_color=C_CARD)
    ctk.CTkFrame(t, height=4, fg_color=C_DANGER, corner_radius=0).pack(fill="x")
    ctk.CTkLabel(t, text="⚠️  Error", font=FONT_SUB,
                 text_color=C_DANGER).pack(pady=(12, 4))
    ctk.CTkLabel(t, text=message, font=FONT_BODY,
                 text_color=C_TEXT_DIM, wraplength=320).pack(pady=4)
    btn(t, "OK", t.destroy, color=C_DANGER, hover=C_DANGER_H, width=100).pack(pady=10)


def confirm(parent, message):
    return messagebox.askyesno("Confirm", message, parent=parent)


# ── App ───────────────────────────────────────────────────────────────────────
class App(ctk.CTk):
    """Main application window."""

    def __init__(self):
        super().__init__()
        try:
            self.backend = AttendanceBackend()
            self.title("AI Attendance System")
            self.geometry("1200x760")
            self.minsize(1100, 700)
            self.configure(fg_color=C_SURFACE)
            self.is_authenticated = False
            self.post_auth_action = None
            self.protocol("WM_DELETE_WINDOW", self.on_closing)

            self.container = ctk.CTkFrame(self, fg_color="transparent")
            self.container.pack(fill="both", expand=True)

            if not self.backend.owner_exists():
                self.show_owner_register()
            else:
                self.show_login()

            # Start WhatsApp daily-report scheduler
            self._last_report_date = None
            self._whatsapp_tick()
        except Exception as e:
            logger.error(f"Init error: {e}", exc_info=True)
            messagebox.showerror("Fatal Error", str(e))

    def on_closing(self):
        try:
            if hasattr(self, "backend") and self.backend:
                self.backend.close()
        finally:
            self.destroy()

    # ── Email scheduler ───────────────────────────────────────────────────────
    def _whatsapp_tick(self):
        """Called every 60 s; sends the daily email report when the clock matches."""
        try:
            enabled = self.backend.get_setting("email_enabled", "false") == "true"
            if enabled:
                report_time = self.backend.get_setting("email_report_time", "18:00")
                now_str     = datetime.now().strftime("%H:%M")
                today_str   = datetime.now().strftime("%Y-%m-%d")
                if now_str == report_time and self._last_report_date != today_str:
                    self._last_report_date = today_str
                    threading.Thread(target=self._send_daily_report,
                                     daemon=True).start()
        except Exception as e:
            logger.error(f"Email scheduler error: {e}")
        self.after(60_000, self._whatsapp_tick)   # check again in 60 s

    def _send_daily_report(self):
        """Build and send the daily email report (runs in background thread)."""
        try:
            sender   = self.backend.get_setting("email_sender",   "")
            password = self.backend.get_setting("email_password", "")
            recip    = self.backend.get_setting("email_recip",    "")
            if not sender or not password or not recip:
                logger.warning("Email report skipped: sender/password/recipients not configured.")
                return
            records          = self.backend.get_today_attendance()
            subject, html    = build_email_report(records)
            ok = send_email_report(sender, password, recip, subject, html)
            if ok:
                logger.info("Daily email report sent.")
            else:
                logger.error("Daily email report failed.")
        except Exception as e:
            logger.error(f"Error sending daily report: {e}", exc_info=True)

    def clear(self):
        for w in self.container.winfo_children():
            w.destroy()

    def show_error(self, message):
        error_dialog(self, message)

    def show_dashboard(self):
        self.clear()
        d = Dashboard(self.container, self)
        d.pack(fill="both", expand=True)
        if self.is_authenticated:
            d.enable_protected_buttons()

    def show_register(self):
        if not self.is_authenticated:
            self.show_login(self.show_register)
            return
        self.clear()
        Register(self.container, self).pack(fill="both", expand=True)

    def show_attendance(self):
        self.clear()
        Attendance(self.container, self).pack(fill="both", expand=True)

    def show_table(self):
        if not self.is_authenticated:
            self.show_login(self.show_table)
            return
        self.clear()
        AttendanceTable(self.container, self).pack(fill="both", expand=True)

    def show_settings(self):
        if not self.is_authenticated:
            self.show_login(self.show_settings)
            return
        self.clear()
        SettingsFrame(self.container, self).pack(fill="both", expand=True)

    def show_owner_register(self):
        self.clear()
        OwnerRegister(self.container, self).pack(fill="both", expand=True)

    def show_login(self, post_action=None):
        self.post_auth_action = post_action
        self.clear()
        LoginScreen(self.container, self).pack(fill="both", expand=True)

    def set_authenticated(self, authenticated=True):
        self.is_authenticated = authenticated
        if authenticated:
            self.show_dashboard()


# ── OwnerRegister ─────────────────────────────────────────────────────────────
class OwnerRegister(ctk.CTkFrame):
    """Register the system owner."""

    def __init__(self, parent, controller):
        super().__init__(parent, fg_color="transparent")
        self.backend = controller.backend
        self.controller = controller
        self.cap = None
        self.frame = None

        wrapper = card(self)
        wrapper.pack(expand=True, padx=60, pady=40)

        ctk.CTkLabel(wrapper, text="🔐  Register Owner",
                     font=FONT_TITLE, text_color=C_TEXT).pack(pady=(30, 4))
        ctk.CTkLabel(wrapper, text="Set up the administrator account for this system.",
                     font=FONT_SMALL, text_color=C_TEXT_DIM).pack(pady=(0, 20))

        self.video = ctk.CTkLabel(wrapper, text="📷  Camera not started",
                                  width=VIDEO_DISPLAY_WIDTH, height=VIDEO_DISPLAY_HEIGHT,
                                  fg_color=C_CARD2, corner_radius=8)
        self.video.pack(pady=10)

        form = ctk.CTkFrame(wrapper, fg_color="transparent")
        form.pack(pady=10)

        self.name_entry = ctk.CTkEntry(form, placeholder_text="Owner Name",
                                       width=300, height=40, font=FONT_BODY)
        self.name_entry.pack(pady=6)

        self.password_entry = ctk.CTkEntry(form, placeholder_text="Password",
                                           width=300, height=40, font=FONT_BODY, show="*")
        self.password_entry.pack(pady=6)

        self.status = ctk.CTkLabel(wrapper, text="", font=FONT_SMALL)
        self.status.pack(pady=4)

        bf = ctk.CTkFrame(wrapper, fg_color="transparent")
        bf.pack(pady=(4, 28))
        btn(bf, "📷  Start Camera", self.start_camera).pack(side="left", padx=8)
        btn(bf, "✅  Register Owner", self.register_owner,
            color=C_SUCCESS, hover=C_SUCCESS_H).pack(side="left", padx=8)

    def start_camera(self):
        if self.cap:
            return
        try:
            self.cap = cv2.VideoCapture(0)
            if not self.cap.isOpened():
                self.controller.show_error("Failed to open camera.")
                return
            self.update_camera()
        except Exception as e:
            self.controller.show_error(str(e))

    def stop_camera(self):
        if self.cap:
            try:
                self.cap.release()
            finally:
                self.cap = None

    def update_camera(self):
        if not self.cap:
            return
        try:
            ret, f = self.cap.read()
            if ret:
                f = cv2.resize(f, (VIDEO_DISPLAY_WIDTH, VIDEO_DISPLAY_HEIGHT))
                self.frame = f.copy()
                img = ImageTk.PhotoImage(Image.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)))
                self.video.configure(image=img)
                self.video.image = img
        except Exception as e:
            logger.error(f"Camera error: {e}")
        self.after(CAMERA_UPDATE_INTERVAL_MS, self.update_camera)

    def register_owner(self):
        name = self.name_entry.get().strip()
        password = self.password_entry.get().strip()
        if not name or not password:
            self.status.configure(text="Please enter name and password.", text_color=C_DANGER)
            return
        if self.frame is None:
            self.status.configure(text="Please start camera and capture a photo.", text_color=C_DANGER)
            return
        try:
            self.backend.register_owner(name, password, self.frame)
            self.status.configure(text="Owner registered! Redirecting...", text_color=C_SUCCESS)
            self.stop_camera()
            self.after(1800, self.controller.show_login)
        except ValueError as e:
            self.status.configure(text=str(e), text_color=C_DANGER)
        except Exception as e:
            logger.error(f"Register owner error: {e}", exc_info=True)
            self.status.configure(text=str(e), text_color=C_DANGER)


# ── LoginScreen ───────────────────────────────────────────────────────────────
class LoginScreen(ctk.CTkFrame):
    """Owner authentication screen."""

    def __init__(self, parent, controller):
        super().__init__(parent, fg_color="transparent")
        self.backend = controller.backend
        self.controller = controller
        self.cap = None
        self.frame = None

        wrapper = card(self)
        wrapper.pack(expand=True, padx=60, pady=40)

        ctk.CTkLabel(wrapper, text="🔑  Owner Login",
                     font=FONT_TITLE, text_color=C_TEXT).pack(pady=(30, 4))
        ctk.CTkLabel(wrapper, text="Authenticate with your face and password.",
                     font=FONT_SMALL, text_color=C_TEXT_DIM).pack(pady=(0, 20))

        self.video = ctk.CTkLabel(wrapper, text="",
                                  width=VIDEO_DISPLAY_WIDTH, height=VIDEO_DISPLAY_HEIGHT,
                                  fg_color=C_CARD2, corner_radius=8)
        self.video.pack(pady=10)

        self.password_entry = ctk.CTkEntry(wrapper, placeholder_text="Password",
                                           width=300, height=40, font=FONT_BODY, show="*")
        self.password_entry.pack(pady=8)

        self.status = ctk.CTkLabel(wrapper, text="Position your face in frame, then authenticate.",
                                   font=FONT_SMALL, text_color=C_TEXT_DIM)
        self.status.pack(pady=4)

        bf = ctk.CTkFrame(wrapper, fg_color="transparent")
        bf.pack(pady=(4, 28))
        btn(bf, "✅  Authenticate", self.authenticate,
            color=C_SUCCESS, hover=C_SUCCESS_H).pack(padx=8)

        self.start_camera()

    def start_camera(self):
        if self.cap:
            return
        try:
            self.cap = cv2.VideoCapture(0)
            if not self.cap.isOpened():
                self.controller.show_error("Failed to open camera.")
                return
            self.update_camera()
        except Exception as e:
            self.controller.show_error(str(e))

    def stop_camera(self):
        if self.cap:
            try:
                self.cap.release()
            finally:
                self.cap = None

    def update_camera(self):
        if not self.cap:
            return
        try:
            ret, f = self.cap.read()
            if ret:
                f = cv2.resize(f, (VIDEO_DISPLAY_WIDTH, VIDEO_DISPLAY_HEIGHT))
                self.frame = f.copy()
                img = ImageTk.PhotoImage(Image.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)))
                self.video.configure(image=img)
                self.video.image = img
        except Exception as e:
            logger.error(f"Camera error: {e}")
        self.after(CAMERA_UPDATE_INTERVAL_MS, self.update_camera)

    def authenticate(self):
        password = self.password_entry.get().strip()
        if not password:
            self.status.configure(text="Please enter your password.", text_color=C_DANGER)
            return
        if self.frame is None:
            self.status.configure(text="Camera not ready yet.", text_color=C_DANGER)
            return
        try:
            if not self.backend.authenticate_owner_password(password):
                self.status.configure(text="Incorrect password.", text_color=C_DANGER)
                return
            if not self.backend.authenticate_owner(self.frame):
                self.status.configure(text="Face not recognised. Try again.", text_color=C_WARNING)
                return
            self.status.configure(text="Authenticated! Loading dashboard...", text_color=C_SUCCESS)
            post = getattr(self.controller, "post_auth_action", None)
            self.controller.post_auth_action = None
            self.stop_camera()
            self.controller.set_authenticated(True)
            if callable(post):
                try:
                    post()
                except Exception:
                    pass
        except Exception as e:
            logger.error(f"Auth error: {e}", exc_info=True)
            self.status.configure(text=str(e), text_color=C_DANGER)


# ── Dashboard ─────────────────────────────────────────────────────────────────
class Dashboard(ctk.CTkFrame):
    """Main dashboard with live clock, today's stats, and card-layout navigation."""

    def __init__(self, parent, controller):
        super().__init__(parent, fg_color="transparent")
        self.controller = controller
        self._clock_job = None

        # ── Top bar ──────────────────────────────────────────────────────────
        topbar = ctk.CTkFrame(self, fg_color=C_CARD, corner_radius=0, height=64)
        topbar.pack(fill="x")
        topbar.pack_propagate(False)

        ctk.CTkLabel(topbar, text="  🏢  AI Attendance System",
                     font=FONT_HEADING, text_color=C_TEXT).pack(side="left", padx=24)

        self.clock_lbl = ctk.CTkLabel(topbar, text="", font=("Roboto", 15),
                                      text_color=C_TEXT_DIM)
        self.clock_lbl.pack(side="right", padx=24)
        self._tick()

        # ── Body ─────────────────────────────────────────────────────────────
        body = ctk.CTkFrame(self, fg_color="transparent")
        body.pack(fill="both", expand=True, padx=40, pady=24)

        # Stats strip
        stats_card = card(body, fg_color=C_CARD2)
        stats_card.pack(fill="x", pady=(0, 18))
        self.stats_lbl = ctk.CTkLabel(stats_card, text="Loading...",
                                      font=FONT_BODY, text_color=C_TEXT_DIM)
        self.stats_lbl.pack(pady=12, padx=20)
        self._refresh_stats()

        # 2×2 button grid
        grid = ctk.CTkFrame(body, fg_color="transparent")
        grid.pack(fill="both", expand=True)
        grid.columnconfigure((0, 1), weight=1)
        grid.rowconfigure((0, 1), weight=1)

        c = controller
        cards_cfg = [
            ("👤  Register Employees",
             "Add, edit, or remove employees\nand manage face profiles.",
             C_PRIMARY, C_PRIMARY_H,
             lambda: c.show_register() if c.is_authenticated else c.show_login(c.show_register),
             True),
            ("📸  Mark Attendance",
             "Open camera to detect faces\nand record entry / exit.",
             C_SUCCESS, C_SUCCESS_H,
             c.show_attendance, False),
            ("📊  View Reports",
             "Browse today's records,\nmonthly irregulars & search.",
             C_PURPLE, C_PURPLE_H,
             lambda: c.show_table() if c.is_authenticated else c.show_login(c.show_table),
             True),
            ("⚙️  Settings",
             "Configure late-arrival thresholds\nand minimum working hours.",
             C_GRAY, C_GRAY_H,
             lambda: c.show_settings() if c.is_authenticated else c.show_login(c.show_settings),
             True),
        ]

        self._protected_btns = []
        for idx, (label, desc, col, hov, cmd, protected) in enumerate(cards_cfg):
            row, col_i = divmod(idx, 2)
            fc = card(grid)
            fc.grid(row=row, column=col_i, padx=10, pady=10, sticky="nsew")
            inner = ctk.CTkFrame(fc, fg_color="transparent")
            inner.pack(expand=True, pady=22, padx=20)
            b = ctk.CTkButton(inner, text=label, font=FONT_SUB,
                              width=300, height=52,
                              fg_color=col, hover_color=hov,
                              corner_radius=10, command=cmd)
            b.pack()
            ctk.CTkLabel(inner, text=desc, font=FONT_SMALL,
                         text_color=C_TEXT_DIM, justify="center").pack(pady=(8, 0))
            if protected:
                self._protected_btns.append(b)

        # Bottom bar
        bot = ctk.CTkFrame(body, fg_color="transparent")
        bot.pack(pady=(14, 0))

        auth_text  = "🔓  Authenticated" if controller.is_authenticated else "🔒  Not Authenticated"
        auth_color = C_SUCCESS if controller.is_authenticated else C_WARNING
        ctk.CTkLabel(bot, text=auth_text, font=FONT_SMALL,
                     text_color=auth_color).pack(side="left", padx=20)

        btn(bot, "🚪  Logout / Reset Owner", self.logout,
            color=C_DANGER, hover=C_DANGER_H, width=200).pack(side="right", padx=20)

    def _tick(self):
        try:
            self.clock_lbl.configure(
                text=datetime.now().strftime("🕐  %H:%M:%S   •   %a %d %b %Y")
            )
            self._clock_job = self.after(1000, self._tick)
        except Exception:
            pass

    def _refresh_stats(self):
        try:
            records = self.controller.backend.get_today_attendance()
            total     = len(records)
            still_in  = sum(1 for r in records if not r[3])
            exited    = total - still_in
            self.stats_lbl.configure(
                text=(f"📅  Today — "
                      f"{total} checked in   •   "
                      f"{still_in} still inside   •   "
                      f"{exited} exited")
            )
        except Exception:
            pass

    def enable_protected_buttons(self):
        for b in self._protected_btns:
            b.configure(state="normal")

    def logout(self):
        if not confirm(self.controller,
                       "This will delete all owner info and require re-registration.\nContinue?"):
            return
        try:
            if self.controller.backend.delete_owner():
                self.controller.is_authenticated = False
                self.controller.show_owner_register()
            else:
                messagebox.showerror("Error", "Failed to delete owner information.")
        except Exception as e:
            logger.error(f"Logout error: {e}", exc_info=True)
            messagebox.showerror("Error", str(e))


# ── Register ──────────────────────────────────────────────────────────────────
class Register(ctk.CTkFrame):
    """Register and manage employees."""

    def __init__(self, parent, controller):
        super().__init__(parent, fg_color="transparent")
        self.backend = controller.backend
        self.controller = controller
        self.cap = None
        self.frame = None
        self.selected_employee = None
        self.selected_button   = None
        self.edit_mode         = False

        # ── Left panel ───────────────────────────────────────────────────────
        left = card(self)
        left.pack(side="left", padx=20, pady=20, fill="y")

        ctk.CTkLabel(left, text="👤  Employee Registration",
                     font=FONT_HEADING, text_color=C_TEXT).pack(pady=(20, 10))

        self.video = ctk.CTkLabel(left, text="📷  Camera not started",
                                  width=VIDEO_DISPLAY_WIDTH, height=VIDEO_DISPLAY_HEIGHT,
                                  fg_color=C_CARD2, corner_radius=8)
        self.video.pack(pady=8, padx=20)

        form = ctk.CTkFrame(left, fg_color="transparent")
        form.pack(pady=6)

        self.name_entry = ctk.CTkEntry(form, placeholder_text="Employee Name",
                                       width=280, height=38, font=FONT_BODY)
        self.name_entry.pack(pady=4)
        self.role_entry = ctk.CTkEntry(form, placeholder_text="Role / Department",
                                       width=280, height=38, font=FONT_BODY)
        self.role_entry.pack(pady=4)

        self.edit_status = ctk.CTkLabel(left, text="", font=FONT_SMALL,
                                        text_color=C_TEXT_DIM)
        self.edit_status.pack(pady=2)

        bf = ctk.CTkFrame(left, fg_color="transparent")
        bf.pack(pady=6)
        btn(bf, "📷  Start Camera", self.start_camera, width=140).pack(side="left", padx=4)
        btn(bf, "💾  Save Employee", self.save_employee,
            color=C_SUCCESS, hover=C_SUCCESS_H, width=140).pack(side="left", padx=4)

        self.add_img_btn = btn(left, "➕  Add More Images", self.add_more_images,
                               color=C_PURPLE, hover=C_PURPLE_H,
                               width=290, height=36, state="disabled")
        self.add_img_btn.pack(pady=4)

        btn(left, "← Back", self.go_back, color=C_GRAY, hover=C_GRAY_H,
            width=290).pack(pady=(4, 20))

        # ── Right panel ──────────────────────────────────────────────────────
        right = card(self)
        right.pack(side="right", padx=20, pady=20, fill="both", expand=True)

        ctk.CTkLabel(right, text="📋  Employee List",
                     font=FONT_SUB, text_color=C_TEXT).pack(pady=(20, 6))

        self.list_frame = ctk.CTkScrollableFrame(right, fg_color=C_CARD2,
                                                  corner_radius=8)
        self.list_frame.pack(fill="both", expand=True, padx=16, pady=6)

        action_row = ctk.CTkFrame(right, fg_color="transparent")
        action_row.pack(pady=(6, 16))

        self.edit_btn = btn(action_row, "✏️  Edit", self.edit_employee,
                            color=C_WARNING, hover="#D97706", state="disabled", width=120)
        self.edit_btn.pack(side="left", padx=6)

        self.del_btn = btn(action_row, "🗑️  Delete", self.delete_employee,
                           color=C_DANGER, hover=C_DANGER_H, state="disabled", width=120)
        self.del_btn.pack(side="left", padx=6)

        self.refresh_list()

    def go_back(self):
        self.stop_camera()
        self.controller.show_dashboard()

    # ── Employee list ─────────────────────────────────────────────────────────
    def refresh_list(self):
        for w in self.list_frame.winfo_children():
            w.destroy()
        self.selected_employee = None
        self.selected_button   = None
        self.edit_btn.configure(state="disabled")
        self.del_btn.configure(state="disabled")
        self.add_img_btn.configure(state="disabled")

        employees = self.backend.get_employee_list()
        if not employees:
            ctk.CTkLabel(self.list_frame, text="No employees registered yet.",
                         font=FONT_SMALL, text_color=C_TEXT_DIM).pack(pady=20)
            return

        for name, role in employees:
            b = ctk.CTkButton(
                self.list_frame,
                text=f"  {name}  •  {role}",
                font=FONT_BODY, anchor="w",
                fg_color=C_CARD, hover_color=C_BORDER,
                height=38, corner_radius=6
            )
            b.configure(command=lambda x=b, n=name, r=role: self.select_employee(x, n, r))
            b.pack(fill="x", pady=2, padx=4)

    def select_employee(self, button, name, role):
        if self.selected_button:
            self.selected_button.configure(fg_color=C_CARD)
        button.configure(fg_color=C_PRIMARY)
        self.selected_button   = button
        self.selected_employee = (name, role)
        self.edit_btn.configure(state="normal")
        self.del_btn.configure(state="normal")
        self.add_img_btn.configure(state="normal")
        self.edit_status.configure(text=f"Selected: {name}  •  {role}", text_color=C_TEXT_DIM)

    def edit_employee(self):
        if not self.selected_employee:
            return
        name, role = self.selected_employee
        self.name_entry.delete(0, "end")
        self.role_entry.delete(0, "end")
        self.name_entry.insert(0, name)
        self.role_entry.insert(0, role)
        self.edit_mode = True
        self.edit_status.configure(text=f"✏️  Editing: {name}", text_color=C_WARNING)

    def delete_employee(self):
        if not self.selected_employee:
            return
        name, _ = self.selected_employee
        if not confirm(self.controller, f"Delete employee '{name}'?\nThis cannot be undone."):
            return
        self.backend.delete_employee(name)
        self.selected_employee = None
        self.edit_mode = False
        self.refresh_list()
        self.edit_status.configure(text=f"Deleted: {name}", text_color=C_DANGER)

    # ── Camera ────────────────────────────────────────────────────────────────
    def start_camera(self):
        if self.cap:
            return
        try:
            self.cap = cv2.VideoCapture(0)
            if not self.cap.isOpened():
                self.controller.show_error("Failed to open camera.")
                return
            self.update_camera()
        except Exception as e:
            self.controller.show_error(str(e))

    def stop_camera(self):
        if self.cap:
            try:
                self.cap.release()
            finally:
                self.cap = None

    def update_camera(self):
        if not self.cap:
            return
        try:
            ret, f = self.cap.read()
            if ret:
                f = cv2.resize(f, (VIDEO_DISPLAY_WIDTH, VIDEO_DISPLAY_HEIGHT))
                self.frame = f.copy()
                img = ImageTk.PhotoImage(Image.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)))
                self.video.configure(image=img)
                self.video.image = img
        except Exception as e:
            logger.error(f"Camera error: {e}")
        self.after(CAMERA_UPDATE_INTERVAL_MS, self.update_camera)

    # ── Save ──────────────────────────────────────────────────────────────────
    def save_employee(self):
        name = self.name_entry.get().strip()
        role = self.role_entry.get().strip()
        if not name or not role:
            error_dialog(self, "Please enter both name and role.")
            return
        try:
            if self.edit_mode and self.selected_employee:
                old_name, _ = self.selected_employee
                self.backend.update_employee(old_name, name, role, frame=self.frame)
                success_toast(self, f"'{name}' updated successfully.")
            else:
                if self.frame is None:
                    error_dialog(self, "Please start the camera and capture a photo first.")
                    return
                self.backend.register_employee(name, role, self.frame)
                success_toast(self, f"'{name}' registered successfully.")
            self._reset_form()
            self.refresh_list()
        except Exception as e:
            logger.error(f"Save employee error: {e}", exc_info=True)
            error_dialog(self, str(e))

    def add_more_images(self):
        if not self.selected_employee:
            error_dialog(self, "Select an employee first.")
            return
        if self.frame is None:
            error_dialog(self, "Please start the camera and capture a photo first.")
            return
        name, _ = self.selected_employee
        try:
            if self.backend.add_employee_image(name, self.frame):
                imgs = self.backend.get_employee_images(name)
                success_toast(self, f"Image added. {name} now has {len(imgs)} photo(s).")
                self.frame = None
            else:
                error_dialog(self, "Failed to add image.")
        except Exception as e:
            error_dialog(self, str(e))

    def _reset_form(self):
        self.edit_mode = False
        self.selected_employee = None
        self.selected_button   = None
        self.frame = None
        self.name_entry.delete(0, "end")
        self.role_entry.delete(0, "end")
        self.edit_status.configure(text="")


# ── Attendance ────────────────────────────────────────────────────────────────
class Attendance(ctk.CTkFrame):
    """Mark attendance via live face recognition."""

    def __init__(self, parent, controller):
        super().__init__(parent, fg_color="transparent")
        self.backend        = controller.backend
        self.controller     = controller
        self.cap            = None
        self.current_frame  = None
        self.detected_names = []
        self.start_time     = time.time()
        self.last_det_time  = 0

        # ── Layout ───────────────────────────────────────────────────────────
        main = card(self)
        main.pack(fill="both", expand=True, padx=30, pady=24)

        ctk.CTkLabel(main, text="📸  Mark Attendance",
                     font=FONT_HEADING, text_color=C_TEXT).pack(pady=(20, 4))
        ctk.CTkLabel(main, text="Stand in front of the camera. When recognised, choose Entering or Leaving.",
                     font=FONT_SMALL, text_color=C_TEXT_DIM).pack()

        self.video_lbl = ctk.CTkLabel(main, text="",
                                      width=VIDEO_DISPLAY_WIDTH, height=VIDEO_DISPLAY_HEIGHT,
                                      fg_color=C_CARD2, corner_radius=8)
        self.video_lbl.pack(pady=12)

        # Status badge
        self.badge = ctk.CTkFrame(main, fg_color=C_CARD2, corner_radius=20, height=44)
        self.badge.pack(fill="x", padx=80, pady=4)
        self.badge.pack_propagate(False)
        self.status_lbl = ctk.CTkLabel(self.badge,
                                        text="⏳  Waiting for face detection...",
                                        font=FONT_SUB, text_color=C_TEXT_DIM)
        self.status_lbl.pack(expand=True)

        bf = ctk.CTkFrame(main, fg_color="transparent")
        bf.pack(pady=12)

        self.entry_btn = btn(bf, "🟢  Entering", self.mark_entry,
                             color=C_SUCCESS, hover=C_SUCCESS_H,
                             width=160, state="disabled")
        self.entry_btn.pack(side="left", padx=12)

        self.exit_btn = btn(bf, "🔴  Leaving", self.mark_exit,
                            color=C_DANGER, hover=C_DANGER_H,
                            width=160, state="disabled")
        self.exit_btn.pack(side="left", padx=12)

        btn(main, "← Back", self.stop_and_back, color=C_GRAY, hover=C_GRAY_H,
            width=120).pack(pady=(4, 20))

        self.start_camera()

    def start_camera(self):
        try:
            self.cap = cv2.VideoCapture(0)
            if not self.cap.isOpened():
                self.controller.show_error("Failed to open camera.")
                return
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_RESOLUTION_WIDTH)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_RESOLUTION_HEIGHT)
            self.update_camera()
        except Exception as e:
            self.controller.show_error(str(e))

    def stop_camera(self):
        if self.cap:
            try:
                self.cap.release()
            finally:
                self.cap = None

    def digital_zoom(self, frame, factor=DIGITAL_ZOOM_FACTOR):
        h, w = frame.shape[:2]
        nw, nh = int(w / factor), int(h / factor)
        x1, y1 = (w - nw) // 2, (h - nh) // 2
        return cv2.resize(frame[y1:y1 + nh, x1:x1 + nw], (w, h))

    def update_camera(self):
        if not self.cap:
            return
        try:
            ret, frame = self.cap.read()
            if ret:
                frame = self.digital_zoom(frame)
                self.current_frame = frame.copy()
                now = time.time()
                if (now - self.start_time > CAMERA_STARTUP_DELAY_SECONDS and
                        now - self.last_det_time > CAMERA_COOLDOWN_SECONDS):
                    try:
                        names = self.backend.recognize_faces(frame)
                        known = [n for n in names
                                 if n != "Unknown" and n in self.backend.known_names]
                        if known:
                            self.detected_names = list(set(known))
                            self.last_det_time  = now
                            self._show_detected()
                    except Exception as e:
                        logger.error(f"Recognition error: {e}")

                display = cv2.resize(frame, (VIDEO_DISPLAY_WIDTH, VIDEO_DISPLAY_HEIGHT))
                img = ImageTk.PhotoImage(
                    Image.fromarray(cv2.cvtColor(display, cv2.COLOR_BGR2RGB)))
                self.video_lbl.configure(image=img)
                self.video_lbl.image = img
        except Exception as e:
            logger.error(f"Camera feed error: {e}")
        self.after(CAMERA_UPDATE_INTERVAL_MS, self.update_camera)

    def _show_detected(self):
        names = ", ".join(self.detected_names)
        self.badge.configure(fg_color=C_SUCCESS)
        self.status_lbl.configure(
            text=f"👋  Detected: {names} — Entering or Leaving?",
            text_color=C_SURFACE)
        self.entry_btn.configure(state="normal")
        self.exit_btn.configure(state="normal")

    def _reset(self):
        self.detected_names = []
        self.badge.configure(fg_color=C_CARD2)
        self.status_lbl.configure(text="⏳  Waiting for face detection...",
                                   text_color=C_TEXT_DIM)
        self.entry_btn.configure(state="disabled")
        self.exit_btn.configure(state="disabled")

    def mark_entry(self):
        if not self.detected_names:
            return
        try:
            for name in self.detected_names:
                self.backend.mark_entry(name)
            success_toast(self, f"Entry marked for: {', '.join(self.detected_names)}")
        except Exception as e:
            error_dialog(self, str(e))
        finally:
            self._reset()

    def mark_exit(self):
        if not self.detected_names:
            return
        try:
            for name in self.detected_names:
                self.backend.mark_exit(name)
            success_toast(self, f"Exit marked for: {', '.join(self.detected_names)}")
        except Exception as e:
            error_dialog(self, str(e))
        finally:
            self._reset()

    def stop_and_back(self):
        self.stop_camera()
        self.controller.show_dashboard()


# ── AttendanceTable ───────────────────────────────────────────────────────────
class AttendanceTable(ctk.CTkFrame):
    """View attendance records with CSV export."""

    def __init__(self, parent, controller):
        super().__init__(parent, fg_color="transparent")
        self.backend    = controller.backend
        self.controller = controller
        self.mode       = ctk.StringVar(value="Today")

        # Header
        hdr = ctk.CTkFrame(self, fg_color=C_CARD, corner_radius=0, height=60)
        hdr.pack(fill="x")
        hdr.pack_propagate(False)
        ctk.CTkLabel(hdr, text="  📊  Attendance Reports",
                     font=FONT_HEADING, text_color=C_TEXT).pack(side="left", padx=20)
        btn(hdr, "← Back", controller.show_dashboard,
            color=C_GRAY, hover=C_GRAY_H, width=100, height=34).pack(side="right", padx=16)

        # Mode selector
        mode_bar = ctk.CTkFrame(self, fg_color=C_CARD2, corner_radius=0, height=46)
        mode_bar.pack(fill="x")
        mode_bar.pack_propagate(False)
        for m in ["Today", "Monthly Irregulars", "Search"]:
            ctk.CTkRadioButton(mode_bar, text=m, variable=self.mode,
                               value=m, font=FONT_BODY,
                               command=self.refresh).pack(side="left", padx=22)

        self.content = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self.content.pack(fill="both", expand=True, padx=20, pady=10)

        self.refresh()

    def clear_content(self):
        for w in self.content.winfo_children():
            w.destroy()

    def refresh(self):
        self.clear_content()
        m = self.mode.get()
        if m == "Today":
            self.today_view()
        elif m == "Monthly Irregulars":
            self.monthly_view()
        else:
            self.search_view()

    # ── Today ─────────────────────────────────────────────────────────────────
    def today_view(self):
        records = self.backend.get_today_attendance()

        ctk.CTkLabel(self.content,
                     text=f"Today — {datetime.now().strftime('%A, %d %B %Y')}",
                     font=FONT_SUB, text_color=C_TEXT_DIM).pack(anchor="w", pady=(4, 10))

        if not records:
            ctk.CTkLabel(self.content, text="No attendance recorded today.",
                         font=FONT_BODY, text_color=C_TEXT_DIM).pack(pady=40)
            return

        for name, role, entry, exit_ in records:
            c = card(self.content, fg_color=C_CARD2)
            c.pack(fill="x", pady=5)

            row = ctk.CTkFrame(c, fg_color="transparent")
            row.pack(fill="x", padx=16, pady=12)

            # Name + role
            ctk.CTkLabel(row, text=f"  {name}", font=FONT_SUB,
                         text_color=C_TEXT).pack(side="left")
            ctk.CTkLabel(row, text=role, font=FONT_SMALL,
                         text_color=C_TEXT_DIM).pack(side="left", padx=(8, 0))

            # Status badge
            if exit_:
                badge_txt, badge_col = f"✅  Exited {exit_}", C_GRAY
            elif entry:
                badge_txt, badge_col = "🟡  Still Inside", C_WARNING
            else:
                badge_txt, badge_col = "❌  Absent", C_DANGER

            badge = ctk.CTkFrame(row, fg_color=badge_col, corner_radius=8)
            badge.pack(side="right", padx=4)
            ctk.CTkLabel(badge, text=badge_txt, font=FONT_SMALL,
                         text_color=C_TEXT).pack(padx=10, pady=4)

            # Entry / exit row
            detail = ctk.CTkFrame(c, fg_color="transparent")
            detail.pack(fill="x", padx=16, pady=(0, 10))
            ctk.CTkLabel(detail, text=f"Entry: {entry or '—'}    Exit: {exit_ or '—'}",
                         font=FONT_SMALL, text_color=C_TEXT_DIM).pack(anchor="w")

        # CSV export
        def export():
            self._export_csv(
                [("Name", "Role", "Entry", "Exit")] +
                [(r[0], r[1], r[2] or "", r[3] or "") for r in records],
                f"today_{datetime.now().strftime('%Y%m%d')}.csv"
            )
        action_row = ctk.CTkFrame(self.content, fg_color="transparent")
        action_row.pack(fill="x", pady=4)

        btn(action_row, "⬇️  Export CSV", export, color=C_PURPLE,
            hover=C_PURPLE_H, width=180).pack(side="right")

        def send_now():
            """Manually send today's report via email."""
            enabled = self.backend.get_setting("email_enabled", "false") == "true"
            if not enabled:
                error_dialog(self, "Email reports are disabled.\nEnable them in Settings first.")
                return
            sender   = self.backend.get_setting("email_sender",   "")
            password = self.backend.get_setting("email_password", "")
            recip    = self.backend.get_setting("email_recip",    "")
            if not sender or not password or not recip:
                error_dialog(self, "Email not configured.\nGo to Settings \u2192 Email Report.")
                return
            subject, html = build_email_report(records)

            def _send():
                ok = send_email_report(sender, password, recip, subject, html)
                self.after(0, lambda: (
                    success_toast(self, "Email report sent!") if ok
                    else error_dialog(self, "Failed to send email.\nCheck your Gmail address, App Password, and internet connection.")
                ))
            threading.Thread(target=_send, daemon=True).start()

        btn(action_row, "\U0001f4e7  Send Report via Email", send_now,
            color=C_SUCCESS, hover=C_SUCCESS_H, width=220).pack(side="left")

    # ── Monthly Irregulars ────────────────────────────────────────────────────
    def monthly_view(self):
        today      = datetime.now()
        irregulars = self.backend.get_monthly_irregulars(today.year, today.month)

        ctk.CTkLabel(self.content,
                     text=f"Monthly Irregulars — {today.strftime('%B %Y')}",
                     font=FONT_SUB, text_color=C_TEXT_DIM).pack(anchor="w", pady=(4, 10))

        if not irregulars:
            ctk.CTkLabel(self.content, text="🎉  No irregular attendance this month!",
                         font=FONT_BODY, text_color=C_SUCCESS).pack(pady=40)
            return

        headers = ["Name", "Role", "Absent Days", "Late Days (>9:30)", "Irregular Dates"]
        tbl = ctk.CTkFrame(self.content, fg_color=C_CARD, corner_radius=8)
        tbl.pack(fill="x")

        widths = [160, 140, 110, 150, 280]
        for ci, (h, w) in enumerate(zip(headers, widths)):
            ctk.CTkLabel(tbl, text=h, font=(FONT_BODY[0], FONT_BODY[1], "bold"),
                         text_color=C_TEXT, width=w).grid(
                row=0, column=ci, padx=6, pady=10)

        for ri, row in enumerate(irregulars, 1):
            bg = C_CARD2 if ri % 2 == 0 else C_CARD
            for ci, (val, w) in enumerate(zip(row, widths)):
                ctk.CTkLabel(tbl, text=str(val), font=FONT_BODY,
                             text_color=C_TEXT_DIM, width=w,
                             wraplength=w - 10, fg_color=bg).grid(
                    row=ri, column=ci, padx=6, pady=6)

        def export():
            self._export_csv(
                [headers] + [list(r) for r in irregulars],
                f"irregulars_{today.strftime('%Y%m')}.csv"
            )
        btn(self.content, "⬇️  Export CSV", export, color=C_PURPLE,
            hover=C_PURPLE_H, width=180).pack(pady=14, anchor="e")

    # ── Search ────────────────────────────────────────────────────────────────
    def search_view(self):
        today = datetime.now()

        ctrl = ctk.CTkFrame(self.content, fg_color="transparent")
        ctrl.pack(fill="x", pady=8)

        date_var  = ctk.StringVar()
        month_var = ctk.StringVar()

        ctk.CTkLabel(ctrl, text="Date (YYYY-MM-DD)", font=FONT_SMALL,
                     text_color=C_TEXT_DIM).grid(row=0, column=0, padx=8)
        ctk.CTkEntry(ctrl, textvariable=date_var, width=150,
                     font=FONT_BODY).grid(row=0, column=1, padx=4)
        ctk.CTkLabel(ctrl, text="OR Month (MM)", font=FONT_SMALL,
                     text_color=C_TEXT_DIM).grid(row=0, column=2, padx=8)
        ctk.CTkEntry(ctrl, textvariable=month_var, width=70,
                     font=FONT_BODY).grid(row=0, column=3, padx=4)

        result_frame = ctk.CTkFrame(self.content, fg_color="transparent")
        result_frame.pack(fill="both", expand=True, pady=10)

        def run_search():
            for w in result_frame.winfo_children():
                w.destroy()
            try:
                if date_var.get():
                    try:
                        datetime.strptime(date_var.get(), "%Y-%m-%d")
                        data = self.backend.get_attendance_by_date(date_var.get())
                        # inject date column
                        data = [(r[0], r[1], date_var.get(), r[2], r[3]) for r in data]
                    except ValueError:
                        ctk.CTkLabel(result_frame,
                                     text="Invalid date format. Use YYYY-MM-DD.",
                                     text_color=C_DANGER).pack()
                        return
                elif month_var.get():
                    try:
                        month = int(month_var.get())
                        if not 1 <= month <= 12:
                            raise ValueError()
                        data = self.backend.get_attendance_by_month(today.year, month)
                    except ValueError:
                        ctk.CTkLabel(result_frame,
                                     text="Invalid month. Enter 1–12.",
                                     text_color=C_DANGER).pack()
                        return
                else:
                    ctk.CTkLabel(result_frame,
                                 text="Enter a date or month to search.",
                                 text_color=C_TEXT_DIM).pack()
                    return

                if not data:
                    ctk.CTkLabel(result_frame, text="No records found.",
                                 text_color=C_TEXT_DIM).pack(pady=20)
                    return

                headers = ["Name", "Role", "Date", "Entry", "Exit"]
                widths  = [160, 140, 120, 110, 110]
                tbl = ctk.CTkFrame(result_frame, fg_color=C_CARD, corner_radius=8)
                tbl.pack(fill="x")

                for ci, (h, w) in enumerate(zip(headers, widths)):
                    ctk.CTkLabel(tbl, text=h,
                                 font=(FONT_BODY[0], FONT_BODY[1], "bold"),
                                 text_color=C_TEXT, width=w).grid(
                        row=0, column=ci, padx=6, pady=10)

                for ri, row in enumerate(data, 1):
                    vals = list(row) if len(row) == 5 else [row[0], row[1], "—", row[2], row[3]]
                    bg   = C_CARD2 if ri % 2 == 0 else C_CARD
                    for ci, (v, w) in enumerate(zip(vals, widths)):
                        ctk.CTkLabel(tbl, text=v or "—", font=FONT_BODY,
                                     text_color=C_TEXT_DIM, width=w,
                                     fg_color=bg).grid(
                            row=ri, column=ci, padx=6, pady=5)

                def export(d=data):
                    self._export_csv(
                        [headers] + [list(r) if len(r) == 5
                                     else [r[0], r[1], "—", r[2], r[3]] for r in d],
                        f"search_{datetime.now().strftime('%Y%m%d%H%M%S')}.csv"
                    )
                btn(result_frame, "⬇️  Export CSV", export,
                    color=C_PURPLE, hover=C_PURPLE_H, width=180).pack(pady=12, anchor="e")

            except Exception as e:
                logger.error(f"Search error: {e}", exc_info=True)
                ctk.CTkLabel(result_frame, text=f"Error: {e}",
                             text_color=C_DANGER).pack()

        btn(ctrl, "🔍  Search", run_search, width=120).grid(row=0, column=4, padx=10)

    # ── CSV helper ────────────────────────────────────────────────────────────
    def _export_csv(self, rows, default_name):
        path = filedialog.asksaveasfilename(
            defaultextension=".csv",
            filetypes=[("CSV files", "*.csv")],
            initialfile=default_name
        )
        if not path:
            return
        try:
            with open(path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerows(rows)
            success_toast(self, f"Exported to {os.path.basename(path)}")
        except Exception as e:
            error_dialog(self, f"Export failed: {e}")


# ── SettingsFrame ─────────────────────────────────────────────────────────────
class SettingsFrame(ctk.CTkFrame):
    """Configure attendance thresholds."""

    def __init__(self, parent, controller):
        super().__init__(parent, fg_color="transparent")
        self.backend    = controller.backend
        self.controller = controller

        wrapper = card(self)
        wrapper.pack(expand=True, padx=80, pady=40)

        ctk.CTkLabel(wrapper, text="⚙️  Attendance Settings",
                     font=FONT_TITLE, text_color=C_TEXT).pack(pady=(28, 4))
        ctk.CTkLabel(wrapper, text="Changes take effect immediately and persist across sessions.",
                     font=FONT_SMALL, text_color=C_TEXT_DIM).pack(pady=(0, 24))

        form = ctk.CTkFrame(wrapper, fg_color=C_CARD2, corner_radius=10)
        form.pack(padx=40, pady=10)

        rows = [
            ("Minimum working hours",              "min_work_hours",     4,     "hours"),
            ("Late arrival threshold  (HH:MM)",    "late_after_time",    "09:30",""),
            ("Min departure time  (HH:MM)",        "min_departure_time", "17:00",""),
        ]

        self._vars = {}
        for ri, (label, key, default, unit) in enumerate(rows):
            ctk.CTkLabel(form, text=label, font=FONT_BODY,
                         text_color=C_TEXT).grid(row=ri, column=0, padx=24, pady=14, sticky="w")
            val = getattr(self.backend, key, None)
            if hasattr(val, "strftime"):
                val = val.strftime("%H:%M")
            if val is None:
                val = default
            var = ctk.StringVar(value=str(val))
            self._vars[key] = var
            ctk.CTkEntry(form, textvariable=var, width=120,
                         font=FONT_BODY).grid(row=ri, column=1, padx=12, pady=14)
            if unit:
                ctk.CTkLabel(form, text=unit, font=FONT_SMALL,
                             text_color=C_TEXT_DIM).grid(row=ri, column=2, padx=8, sticky="w")

        # ── Email report section ──────────────────────────────────────────────
        em_card = card(wrapper, fg_color=C_CARD2)
        em_card.pack(fill="x", padx=40, pady=(16, 4))

        em_title = ctk.CTkFrame(em_card, fg_color="transparent")
        em_title.pack(fill="x", padx=16, pady=(12, 4))
        ctk.CTkLabel(em_title, text="\U0001f4e7  Email Daily Report",
                     font=FONT_SUB, text_color=C_TEXT).pack(side="left")

        em_enabled_val = self.backend.get_setting("email_enabled", "false") == "true"
        self._wa_enabled_var = ctk.BooleanVar(value=em_enabled_val)
        ctk.CTkSwitch(em_title, text="Enabled", variable=self._wa_enabled_var,
                      font=FONT_SMALL, onvalue=True, offvalue=False).pack(side="right", padx=8)

        ctk.CTkLabel(em_card,
                     text="Uses Gmail SMTP. Requires a Gmail App Password (not your real password).\n"
                          "Get one at: myaccount.google.com \u2192 Security \u2192 App Passwords",
                     font=FONT_SMALL, text_color=C_TEXT_DIM, justify="left").pack(
            anchor="w", padx=16, pady=(0, 8))

        em_form = ctk.CTkFrame(em_card, fg_color="transparent")
        em_form.pack(padx=16, pady=(4, 16))

        em_rows = [
            ("Sender Gmail address",          "email_sender",      ""),
            ("Gmail App Password (16 chars)",  "email_password",    ""),
            ("Recipient email(s) (comma-sep)", "email_recip",       ""),
            ("Report time  (HH:MM)",           "email_report_time", "18:00"),
        ]
        for ri, (label, key, default) in enumerate(em_rows):
            ctk.CTkLabel(em_form, text=label, font=FONT_BODY,
                         text_color=C_TEXT).grid(row=ri, column=0, padx=8, pady=8, sticky="w")
            val = self.backend.get_setting(key, default) or default
            show = "*" if key == "email_password" else ""
            var = ctk.StringVar(value=val)
            self._vars[key] = var
            ctk.CTkEntry(em_form, textvariable=var, width=280,
                         font=FONT_BODY, show=show).grid(row=ri, column=1, padx=8, pady=8)

        bf = ctk.CTkFrame(wrapper, fg_color="transparent")
        bf.pack(pady=(20, 28))
        btn(bf, "💾  Save", self.save_settings,
            color=C_SUCCESS, hover=C_SUCCESS_H, width=140).pack(side="left", padx=10)
        btn(bf, "Cancel", controller.show_dashboard,
            color=C_GRAY, hover=C_GRAY_H, width=120).pack(side="left", padx=10)

    def save_settings(self):
        def validate_time(s):
            parts = s.split(":")
            if len(parts) < 2:
                raise ValueError("Time must be HH:MM")
            h, m = int(parts[0]), int(parts[1])
            if not (0 <= h < 24 and 0 <= m < 60):
                raise ValueError("Hour 0-23, minute 0-59")
            return f"{h:02d}:{m:02d}"

        try:
            mh = float(self._vars["min_work_hours"].get())
            if mh < 0:
                raise ValueError("Minimum hours must be >= 0")
        except Exception as e:
            error_dialog(self, f"Invalid working hours: {e}")
            return

        try:
            la = validate_time(self._vars["late_after_time"].get())
            md = validate_time(self._vars["min_departure_time"].get())
        except Exception as e:
            error_dialog(self, f"Invalid time format: {e}")
            return

        # Email settings
        em_sender  = self._vars.get("email_sender",      ctk.StringVar()).get().strip()
        em_pass    = self._vars.get("email_password",    ctk.StringVar()).get().strip()
        em_recip   = self._vars.get("email_recip",       ctk.StringVar()).get().strip()
        em_time_raw = self._vars.get("email_report_time", ctk.StringVar(value="18:00")).get().strip()

        try:
            em_time = validate_time(em_time_raw)
        except Exception as e:
            error_dialog(self, f"Invalid email report time: {e}")
            return

        ok = all([
            self.backend.set_setting("min_work_hours",    str(mh)),
            self.backend.set_setting("late_after_time",   la),
            self.backend.set_setting("min_departure_time", md),
            self.backend.set_setting("email_enabled",     "true" if self._wa_enabled_var.get() else "false"),
            self.backend.set_setting("email_sender",      em_sender),
            self.backend.set_setting("email_password",    em_pass),
            self.backend.set_setting("email_recip",       em_recip),
            self.backend.set_setting("email_report_time", em_time),
        ])

        if ok:
            success_toast(self, "Settings saved successfully.")
            self.after(2200, self.controller.show_dashboard)
        else:
            error_dialog(self, "Failed to save one or more settings. Check logs.")


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    App().mainloop()
