# 📧 Daily Attendance Email Report — Setup Guide

This guide will help you set up the automatic daily attendance report  
that gets emailed to you every day at a time you choose.

---

## ✅ What You Need

- A **Gmail account** (the one that will *send* the report)
- The email address(es) where you want to *receive* the report
- About **5 minutes**

---

## Step 1 — Enable 2-Step Verification on Gmail

> ⚠️ This is required by Google to allow apps to send emails.  
> If you already have it turned on, skip to Step 2.

1. Open your browser and go to:  
   👉 **https://myaccount.google.com/security**

2. Sign in to the Gmail account that will **send** the reports.

3. Find **"2-Step Verification"** and click it.

4. Follow the on-screen steps to turn it on  
   (usually just confirming with your phone).

---

## Step 2 — Create a Gmail App Password

> This is a special password **only for this app**.  
> It is different from your regular Gmail password.

1. On the same security page:  
   👉 **https://myaccount.google.com/security**

2. In the search bar at the top of the page, type:  
   `App Passwords`  
   and click it in the results.

3. You may be asked to sign in again — that's normal.

4. Under **"App name"**, type anything, for example:  
   `Attendance System`

5. Click **"Create"**.

6. Google will show you a **16-character password** like this:  
   ```
   abcd efgh ijkl mnop
   ```

7. **Copy this password** (you will need it in Step 3).  
   ⚠️ Remove the spaces when entering it into the app — use: `abcdefghijklmnop`

---

## Step 3 — Enter Your Details in the App

1. Open the **AI Attendance System** app.

2. Log in as the owner.

3. From the dashboard, click **⚙️ Settings**.

4. Scroll down to the **"📧 Email Daily Report"** section.

5. Fill in the following fields:

   | Field | What to Enter | Example |
   |---|---|---|
   | **Sender Gmail address** | The Gmail you used in Steps 1 & 2 | `yourname@gmail.com` |
   | **Gmail App Password** | The 16-char password from Step 2 (no spaces) | `abcdefghijklmnop` |
   | **Recipient email(s)** | Where to send the report (can be multiple, comma-separated) | `boss@company.com, me@gmail.com` |
   | **Report time** | What time to auto-send the report each day (24-hr format) | `18:00` |

6. Toggle the **"Enabled"** switch to **ON**.

7. Click **💾 Save**.

---

## Step 4 — Test It

1. Go to the dashboard → click **📊 View Reports**.

2. Make sure **"Today"** tab is selected.

3. Click the **"📧 Send Report via Email"** button.

4. Check your inbox — the report should arrive within a minute.

> ✅ If you receive the email, you are all set!  
> The system will now automatically send the report every day at the time you configured.

---

## ❓ Troubleshooting

| Problem | Solution |
|---|---|
| "Authentication error" | Double-check the Gmail address and App Password. Make sure there are no extra spaces. |
| "Failed to send email" | Check your internet connection. Make sure the App Password hasn't been deleted from Google. |
| "App Passwords not found" | Make sure 2-Step Verification is fully enabled first. |
| Report not arriving automatically | Check that the "Enabled" toggle is ON in Settings and the report time is saved correctly. |
| Email goes to spam | Open the email and click "Not spam" — future emails will go to inbox. |

---

## 🔒 Privacy Note

Your Gmail App Password is stored locally in the `attendance.db`  
database file on this computer only. It is never sent anywhere  
except directly to Gmail's servers to send the report.

---

*Setup guide for AI Attendance System*
