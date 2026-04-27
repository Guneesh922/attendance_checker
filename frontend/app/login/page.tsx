"use client";
import { useState, useEffect, useRef } from "react";
import { signInWithEmailAndPassword, signInWithCustomToken, onAuthStateChanged } from "firebase/auth";
import { auth } from "../../lib/firebase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";

type Tab = "password" | "face";

export default function LoginPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [tab, setTab] = useState<Tab>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [faceEmail, setFaceEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      if (u) router.replace("/");
    });
  }, [router]);

  // Start/stop camera when switching to/from face tab
  useEffect(() => {
    if (tab !== "face") {
      stopCamera();
      return;
    }
    startCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Clean up camera on unmount
  useEffect(() => {
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startCamera() {
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" } })
      .then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCameraReady(true);
        }
      })
      .catch(() => {
        setError("Camera access denied. Please allow camera permissions.");
      });
  }

  function stopCamera() {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }

  function switchTab(next: Tab) {
    setError("");
    setTab(next);
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      document.cookie = "session=1; path=/; max-age=3600; SameSite=Strict";
      router.replace("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleFaceLogin() {
    if (!faceEmail) {
      setError("Please enter your email first.");
      return;
    }
    if (!videoRef.current || !canvasRef.current) return;

    setError("");
    setLoading(true);

    try {
      const ctx = canvasRef.current.getContext("2d");
      if (!ctx) throw new Error("Could not get canvas context");
      ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);

      const imageB64 = await new Promise<string>((resolve, reject) => {
        canvasRef.current!.toBlob((blob) => {
          if (!blob) return reject(new Error("Could not capture image"));
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            // Strip the data URL prefix to get raw base64
            resolve(result.split(",")[1]);
          };
          reader.readAsDataURL(blob);
        }, "image/jpeg");
      });

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "";
      const base = apiUrl.replace(/\/+$/, "");

      const { data } = await axios.post(`${base}/auth/login-with-face`, {
        email: faceEmail,
        image_b64: imageB64,
      });

      if (!data.authenticated) {
        const reasons: Record<string, string> = {
          face_mismatch: "Face not recognised. Try again or use password.",
          no_face_detected: "No face detected — make sure your face is clearly visible.",
          no_face_registered: "No face registered for this account. Sign in with password first.",
          no_face_in_stored_image: "Your stored face photo has no detectable face. Re-register via Settings.",
          account_incomplete: "Account setup incomplete. Please sign in with password.",
          stored_image_invalid: "Stored face image could not be read. Please re-register.",
        };
        setError(reasons[data.reason] ?? "Face authentication failed.");
        return;
      }

      // Sign in to Firebase using the custom token from the backend
      await signInWithCustomToken(auth, data.custom_token);
      document.cookie = "session=1; path=/; max-age=3600; SameSite=Strict";
      router.replace("/");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Face login failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mb-3 text-4xl">🏢</div>
          <h1 className="text-2xl font-bold text-white">Attendance System</h1>
          <p className="mt-1 text-sm text-slate-400">Owner portal — sign in to continue</p>
        </div>

        {/* Tab switcher */}
        <div className="mb-6 flex rounded-lg border border-slate-700 p-1">
          <button
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
              tab === "password"
                ? "bg-indigo-600 text-white"
                : "text-slate-400 hover:text-white"
            }`}
            onClick={() => switchTab("password")}
          >
            Password
          </button>
          <button
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
              tab === "face"
                ? "bg-indigo-600 text-white"
                : "text-slate-400 hover:text-white"
            }`}
            onClick={() => switchTab("face")}
          >
            Face ID
          </button>
        </div>

        {tab === "password" ? (
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                placeholder="owner@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="rounded-lg bg-red-900/40 p-3 text-sm text-red-300">{error}</p>}
            <button className="btn-primary w-full" type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                placeholder="owner@email.com"
                value={faceEmail}
                onChange={(e) => setFaceEmail(e.target.value)}
              />
            </div>

            <div className="relative overflow-hidden rounded-lg bg-slate-900">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="h-52 w-full object-cover"
              />
              {!cameraReady && (
                <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">
                  Starting camera…
                </div>
              )}
            </div>
            <canvas ref={canvasRef} width={640} height={416} className="hidden" />

            {error && <p className="rounded-lg bg-red-900/40 p-3 text-sm text-red-300">{error}</p>}

            <button
              className="btn-primary w-full"
              onClick={handleFaceLogin}
              disabled={loading || !cameraReady}
            >
              {loading ? "Verifying face…" : "Sign In with Face"}
            </button>
          </div>
        )}

        <div className="mt-6 border-t border-slate-700 pt-4 text-center">
          <p className="text-sm text-slate-400">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-blue-400 hover:text-blue-300">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
