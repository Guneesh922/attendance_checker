"""
email_reporter.py
─────────────────
Sends the daily attendance report as a formatted HTML email via Gmail SMTP.

Uses Python's built-in smtplib — no extra packages required.

Setup for the user
──────────────────
1. Have a Gmail account.
2. Enable 2-Step Verification on that account:
       myaccount.google.com → Security → 2-Step Verification
3. Create an App Password:
       myaccount.google.com → Security → App Passwords
       Choose: Mail + your device, then copy the 16-char password.
4. In the app Settings enter:
       • Sender Gmail address   (the Gmail you used above)
       • Gmail App Password     (the 16-char code, NOT your real password)
       • Recipient email(s)     (comma-separated list of who should receive it)
       • Report time            (HH:MM, e.g. 18:00)
"""

import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text      import MIMEText
from datetime             import datetime

logger = logging.getLogger(__name__)

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587


def send_email_report(sender: str, app_password: str,
                      recipients: str, subject: str, html_body: str) -> bool:
    """
    Send an HTML email via Gmail SMTP.

    Args:
        sender      : Sender Gmail address.
        app_password: 16-char Gmail App Password.
        recipients  : Comma-separated recipient email addresses.
        subject     : Email subject line.
        html_body   : HTML string for the email body.

    Returns:
        True on success, False on failure.
    """
    if not sender or not app_password or not recipients:
        logger.error("Email send failed: sender, password, or recipients not configured.")
        return False

    to_list = [r.strip() for r in recipients.split(",") if r.strip()]
    if not to_list:
        logger.error("Email send failed: no valid recipient addresses.")
        return False

    msg                    = MIMEMultipart("alternative")
    msg["Subject"]         = subject
    msg["From"]            = sender
    msg["To"]              = ", ".join(to_list)
    msg.attach(MIMEText(html_body, "html"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
            server.ehlo()
            server.starttls()
            server.login(sender.strip(), app_password.strip())
            server.sendmail(sender.strip(), to_list, msg.as_string())
        logger.info(f"Email report sent to: {', '.join(to_list)}")
        return True
    except smtplib.SMTPAuthenticationError:
        logger.error("Email send failed: authentication error. Check Gmail address and App Password.")
        return False
    except smtplib.SMTPException as e:
        logger.error(f"Email send failed (SMTP): {e}")
        return False
    except Exception as e:
        logger.error(f"Email send failed: {e}", exc_info=True)
        return False


def build_email_report(records: list, date_str: str | None = None) -> tuple[str, str]:
    """
    Build a subject line and HTML body for the daily attendance report.

    Args:
        records  : List of (name, role, entry_time, exit_time) tuples.
        date_str : Human-readable date. Defaults to today.

    Returns:
        (subject, html_body)
    """
    if date_str is None:
        date_str = datetime.now().strftime("%A, %d %B %Y")

    total    = len(records)
    exited   = sum(1 for r in records if r[3])
    still_in = total - exited
    subject  = f"📊 Daily Attendance Report — {date_str}"

    # Build table rows
    if records:
        rows_html = ""
        for i, (name, role, entry, exit_) in enumerate(records):
            bg          = "#1E2235" if i % 2 == 0 else "#252A3D"
            status_txt  = "✅ Exited"       if exit_  else "🟡 Still Inside"
            status_col  = "#10B981"          if exit_  else "#F59E0B"
            entry_str   = entry  or "—"
            exit_str    = exit_  or "—"
            rows_html += f"""
            <tr style="background:{bg};">
                <td style="padding:10px 14px;">{name}</td>
                <td style="padding:10px 14px;color:#94A3B8;">{role}</td>
                <td style="padding:10px 14px;">{entry_str}</td>
                <td style="padding:10px 14px;">{exit_str}</td>
                <td style="padding:10px 14px;">
                    <span style="color:{status_col};font-weight:600;">{status_txt}</span>
                </td>
            </tr>"""
        table_html = f"""
        <table style="width:100%;border-collapse:collapse;margin-top:20px;
                       font-family:Roboto,Arial,sans-serif;font-size:14px;color:#F1F5F9;">
            <thead>
                <tr style="background:#5B6AF0;">
                    <th style="padding:12px 14px;text-align:left;">Name</th>
                    <th style="padding:12px 14px;text-align:left;">Role</th>
                    <th style="padding:12px 14px;text-align:left;">Entry</th>
                    <th style="padding:12px 14px;text-align:left;">Exit</th>
                    <th style="padding:12px 14px;text-align:left;">Status</th>
                </tr>
            </thead>
            <tbody>{rows_html}</tbody>
        </table>"""
    else:
        table_html = "<p style='color:#94A3B8;margin-top:20px;'>No attendance recorded today.</p>"

    html = f"""
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;background:#181C2E;font-family:Roboto,Arial,sans-serif;">
        <div style="max-width:700px;margin:30px auto;background:#1E2235;
                    border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.4);">

            <!-- Header -->
            <div style="background:#5B6AF0;padding:28px 32px;">
                <h1 style="margin:0;color:#fff;font-size:22px;">📊 Daily Attendance Report</h1>
                <p  style="margin:6px 0 0;color:#C7D2FE;font-size:14px;">{date_str}</p>
            </div>

            <!-- Stats strip -->
            <div style="display:flex;gap:0;border-bottom:1px solid #2E3450;">
                <div style="flex:1;padding:18px 24px;text-align:center;border-right:1px solid #2E3450;">
                    <div style="font-size:28px;font-weight:700;color:#F1F5F9;">{total}</div>
                    <div style="font-size:12px;color:#94A3B8;margin-top:4px;">Checked In</div>
                </div>
                <div style="flex:1;padding:18px 24px;text-align:center;border-right:1px solid #2E3450;">
                    <div style="font-size:28px;font-weight:700;color:#10B981;">{exited}</div>
                    <div style="font-size:12px;color:#94A3B8;margin-top:4px;">Exited</div>
                </div>
                <div style="flex:1;padding:18px 24px;text-align:center;">
                    <div style="font-size:28px;font-weight:700;color:#F59E0B;">{still_in}</div>
                    <div style="font-size:12px;color:#94A3B8;margin-top:4px;">Still Inside</div>
                </div>
            </div>

            <!-- Table -->
            <div style="padding:20px 28px 32px;">
                {table_html}
            </div>

            <!-- Footer -->
            <div style="background:#181C2E;padding:16px 28px;
                        font-size:12px;color:#4B5563;text-align:center;">
                Sent automatically by AI Attendance System
            </div>
        </div>
    </body>
    </html>"""

    return subject, html
