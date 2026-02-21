# 👥 AI Employee Attendance Checker

An AI-powered employee attendance management system using real-time face recognition, built with Python and a modern dark-mode GUI.

[![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![OpenCV](https://img.shields.io/badge/OpenCV-4.9-green.svg)](https://opencv.org/)
[![CustomTkinter](https://img.shields.io/badge/UI-CustomTkinter-purple.svg)](https://github.com/TomSchimansky/CustomTkinter)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## ✨ Features

- **👤 Employee Registration** — Register employees with face recognition; supports multiple photos per employee for better accuracy
- **📸 Live Face Recognition** — Real-time camera detection with digital zoom and colour-coded status badges
- **⏰ Attendance Tracking** — Mark entry and exit times with a single click after face detection
- **📊 Reports Dashboard** — View today's attendance, monthly irregulars, and searchable history
- **⬇️ CSV Export** — Export any report view to a `.csv` file
- **📧 Daily Email Report** — Automatically email a formatted HTML attendance summary at a configured time each day
- **📧 Manual Send** — Send today's report instantly via the "Send Report via Email" button
- **⚠️ Irregularity Detection** — Flags late arrivals (after configurable threshold), low hours, and absences
- **⚙️ Configurable Settings** — Set minimum work hours, late-arrival time, departure time, and email report details — all persisted to the database
- **🔐 Owner Authentication** — Face + password login for the administrator; protected screens require authentication
- **🕐 Live Dashboard Clock** — Real-time clock and today's attendance stats visible on the dashboard

---

## 🖥️ Screenshots

> Dark-mode UI with card-layout dashboard, live clock, and colour-coded attendance cards.

---

## 📋 Project Structure

```
AttendanceChecker_Distribution/
├── main.py                  # Main GUI application (CustomTkinter)
├── backend.py               # Business logic, face recognition & database
├── email_reporter.py        # Daily email report via Gmail SMTP
├── requirements.txt         # Python dependencies
├── attendance.db            # SQLite database (auto-created on first run)
├── Employee_Images/         # Stored employee face photos
├── Owner_Images/            # Owner face photo for authentication
└── EMAIL_SETUP_GUIDE.md     # Step-by-step guide for email report setup
```

---

## 🛠️ Technologies Used

| Library | Purpose |
|---|---|
| Python 3.10+ | Core language |
| CustomTkinter | Modern dark-mode GUI |
| OpenCV | Camera access and image processing |
| face_recognition + dlib | Face detection and recognition |
| SQLite | Local database for all records |
| Pillow (PIL) | Image manipulation |
| smtplib (built-in) | Email report via Gmail SMTP |

---

## ⚡ Installation

### Recommended — Conda (Windows, avoids compiling dlib)

```powershell
# 1. Create and activate environment
conda create -n attendance python=3.10 -y
conda activate attendance

# 2. Install compiled dependencies
conda install -c conda-forge dlib face-recognition opencv numpy pillow -y

# 3. Install remaining packages
pip install customtkinter==5.2.2

# 4. Run the app
python main.py
```

### Alternative — pip only (requires Visual Studio Build Tools + CMake)

```powershell
pip install cmake
pip install dlib==19.24.2
pip install -r requirements.txt
```

> ⚠️ On Windows, `dlib` must be installed **before** `face-recognition`.  
> If pip fails, use the Conda method above.

### macOS / Linux

```bash
pip3 install cmake
pip3 install dlib==19.24.2
pip3 install -r requirements.txt
python3 main.py
```

---

## 🚀 Usage

### 1. First Launch — Register Owner
On first run, you will be prompted to register the **owner (administrator)**:
- Enter your name and a password
- Start the camera and position your face
- Click **Register Owner**

### 2. Login
On subsequent launches, authenticate with your **face + password** to access protected features.

### 3. Register Employees
- Click **👤 Register Employees** from the dashboard
- Enter the employee's name and role
- Start the camera and click **Save Employee**
- Optionally click **Add More Images** to improve recognition accuracy

### 4. Mark Attendance
- Click **📸 Mark Attendance**
- The camera starts automatically and detects registered faces
- When a face is recognised, click **Entering** or **Leaving**

### 5. View Reports
- Click **📊 View Reports**
- Switch between **Today**, **Monthly Irregulars**, and **Search** views
- Export any view to CSV using the **⬇️ Export CSV** button
- Send the current day's report via **📧 Send Report via Email**

### 6. Configure Settings
- Click **⚙️ Settings**
- Adjust late-arrival threshold, minimum working hours, and departure time
- Set up the **Email Daily Report** (see `EMAIL_SETUP_GUIDE.md`)

---

## 📧 Email Daily Report Setup

See **[EMAIL_SETUP_GUIDE.md](EMAIL_SETUP_GUIDE.md)** for the full step-by-step guide.

**Summary:**
1. Enable **2-Step Verification** on Gmail: https://myaccount.google.com/security
2. Create a **Gmail App Password** (Security → App Passwords)
3. In the app, go to **Settings → Email Daily Report** and enter:
   - Sender Gmail address
   - Gmail App Password (16 chars, no spaces)
   - Recipient email(s) — comma-separated
   - Report time (e.g. `18:00`)
4. Toggle **Enabled** → **Save**

---

## 📊 Monthly Irregulars

The system automatically tracks and flags:

| Type | Condition |
|---|---|
| **Absent** | No entry recorded for a working day |
| **Late arrival** | Entry time after the configured threshold (default: 09:30) |
| **Low hours** | Worked less than the configured minimum (default: 6 hours) |
| **Early departure** | Exit before the configured minimum departure time (default: 17:00) |

---

## 🔒 Security Notes

- The owner authentication requires **both** face recognition **and** password
- All data (including the Gmail App Password) is stored locally in `attendance.db` — nothing is sent to external servers
- If you delete `attendance.db`, the app recreates a fresh database automatically (but all attendance history and employee records will be lost)

---

## ❓ Troubleshooting

| Issue | Fix |
|---|---|
| Camera not opening | Check camera permissions (Windows: Settings → Privacy → Camera) |
| `dlib` install fails | Use the Conda installation method |
| Face not recognised | Add more images using **Add More Images** in the Register screen |
| Email not sending | Check Gmail address, App Password (no spaces), and internet connection |
| App opens but looks blurry | Set VS Code Python interpreter to the system Python (not a venv) |

---

## 📝 License

This project is licensed under the MIT License.
