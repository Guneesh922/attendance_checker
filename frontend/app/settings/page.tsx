"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../../lib/firebase";
import Nav from "../../components/Nav";
import { getSettings, saveSettings, saveEmailConfig } from "../../lib/api";
import axios from "axios";

export default function SettingsPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [facesVerified, setFacesVerified] = useState(false);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [token, setToken] = useState<string>("");
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [verificationError, setVerificationError] = useState("");
  
  const [s, setS] = useState({
    min_work_hours: "4",
    late_after_time: "09:30:00",
    min_departure_time: "17:00:00",
    email_sender: "",
    email_app_password: "",
    email_recipients: "",
    email_report_time: "18:00",
    email_enabled: "0",
  });
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      const idToken = await user.getIdToken();
      setToken(idToken);
    });
    return unsubscribe;
  }, [router]);

  // Initialize camera for face verification
  useEffect(() => {
    if (!showVerificationModal) return;
    
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Camera access error:", err);
        setVerificationError("Could not access camera. Please check permissions.");
      }
    };
    
    startCamera();
    
    return () => {
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, [showVerificationModal]);

  async function verifyFace() {
    if (!videoRef.current || !canvasRef.current) return;
    
    setVerificationLoading(true);
    setVerificationError("");

    try {
      // Draw current frame to canvas
      const ctx = canvasRef.current.getContext("2d");
      if (!ctx) throw new Error("Could not get canvas context");
      
      ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
      
      // Convert canvas to blob
      canvasRef.current.toBlob(async (blob) => {
        if (!blob) throw new Error("Could not convert canvas to blob");
        
        const fd = new FormData();
        fd.append("file", blob, "face.jpg");
        
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        
        try {
          const response = await axios.post(`${apiUrl}/auth/verify-owner-face`, fd, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          
          if (response.data.authenticated) {
            setFacesVerified(true);
            setShowVerificationModal(false);
          } else {
            setVerificationError("Face not recognized. Please try again.");
            setVerificationLoading(false);
          }
        } catch (err) {
          console.error("Face verification error:", err);
          setVerificationError("Failed to verify face. Please try again.");
          setVerificationLoading(false);
        }
      }, "image/jpeg");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to verify face";
      setVerificationError(errorMessage);
      setVerificationLoading(false);
    }
  }  
  useEffect(() => {
    if (!facesVerified) return;
    
    getSettings()
      .then((r) => setS((prev) => ({ ...prev, ...r.data })))
      .catch(console.error);
  }, [facesVerified]);

  function update(key: string, val: string) {
    setS((prev) => ({ ...prev, [key]: val }));
  }

  async function saveThresholds() {
    try {
      await saveSettings({
        min_work_hours: s.min_work_hours,
        late_after_time: s.late_after_time,
        min_departure_time: s.min_departure_time,
      });
      setMsg("✅ Thresholds saved");
    } catch { setMsg("❌ Save failed"); }
  }

  async function saveEmail() {
    try {
      await saveEmailConfig({
        sender: s.email_sender,
        app_password: s.email_app_password,
        recipients: s.email_recipients,
        report_time: s.email_report_time,
        enabled: s.email_enabled === "1",
      });
      setMsg("✅ Email settings saved");
    } catch { setMsg("❌ Save failed"); }
  }

  return (
    <>
      {!facesVerified && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/80 z-50">
          <div className="card w-full max-w-sm">
            <div className="mb-8 text-center">
              <div className="mb-3 text-4xl">🔐</div>
              <h1 className="text-2xl font-bold text-white">Verify Your Face</h1>
              <p className="mt-1 text-sm text-slate-400">Verify your identity to access settings</p>
            </div>

            <div className="space-y-4">
              <div className="relative overflow-hidden rounded-lg bg-slate-900">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="h-64 w-full"
                />
                <canvas
                  ref={canvasRef}
                  width={320}
                  height={256}
                  className="hidden"
                />
              </div>

              {verificationError && (
                <p className="rounded-lg bg-red-900/40 p-3 text-sm text-red-300">
                  {verificationError}
                </p>
              )}

              <button
                onClick={verifyFace}
                disabled={verificationLoading}
                className="btn-primary w-full"
              >
                {verificationLoading ? "Verifying face…" : "Verify Face"}
              </button>
            </div>
          </div>
        </div>
      )}

      {facesVerified && (
        <>
          <Nav />
          <main className="mx-auto max-w-2xl p-6 space-y-6">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        {msg && <p className="text-sm text-slate-300">{msg}</p>}

        {/* Thresholds */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-white">Attendance Thresholds</h2>
          <div>
            <label className="label">Min Work Hours</label>
            <input id="min-hours" className="input" type="number" step="0.5" value={s.min_work_hours}
              onChange={(e) => update("min_work_hours", e.target.value)} />
          </div>
          <div>
            <label className="label">Late After (HH:MM:SS)</label>
            <input id="late-time" className="input" value={s.late_after_time}
              onChange={(e) => update("late_after_time", e.target.value)} />
          </div>
          <div>
            <label className="label">Min Departure Time (HH:MM:SS)</label>
            <input id="min-departure" className="input" value={s.min_departure_time}
              onChange={(e) => update("min_departure_time", e.target.value)} />
          </div>
          <button id="save-thresholds-btn" className="btn-primary" onClick={saveThresholds}>Save Thresholds</button>
        </div>

        {/* Email */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-white">Email Report</h2>
          <div>
            <label className="label">Sender Gmail</label>
            <input id="email-sender" className="input" type="email" value={s.email_sender}
              onChange={(e) => update("email_sender", e.target.value)} />
          </div>
          <div>
            <label className="label">Gmail App Password</label>
            <input id="email-password" className="input" type="password" value={s.email_app_password}
              onChange={(e) => update("email_app_password", e.target.value)} />
          </div>
          <div>
            <label className="label">Recipients (comma-separated)</label>
            <input id="email-recipients" className="input" value={s.email_recipients}
              onChange={(e) => update("email_recipients", e.target.value)} />
          </div>
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="label">Daily Send Time (HH:MM)</label>
              <input id="email-time" className="input" value={s.email_report_time}
                onChange={(e) => update("email_report_time", e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300 mb-1">
              <input id="email-enabled" type="checkbox" checked={s.email_enabled === "1"}
                onChange={(e) => update("email_enabled", e.target.checked ? "1" : "0")} />
              Enabled
            </label>
          </div>
          <button id="save-email-btn" className="btn-primary" onClick={saveEmail}>Save Email Settings</button>
        </div>
      </main>
        </>
      )}
    </>
  );
}
