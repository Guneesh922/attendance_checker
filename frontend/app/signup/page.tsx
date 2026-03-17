"use client";
import { useState, useEffect, useRef } from "react";
import { createUserWithEmailAndPassword, onAuthStateChanged } from "firebase/auth";
import { auth } from "../../lib/firebase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";

export default function SignupPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [step, setStep] = useState<"form" | "face">("form"); // Track signup steps
  const [formData, setFormData] = useState({
    organizationName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string>("");

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      if (u && step === "form") router.replace("/");
    });
  }, [router, step]);

  // Initialize camera when on face capture step
  useEffect(() => {
    if (step !== "face") return;
    
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
        setError("Could not access camera. Please check permissions.");
      }
    };
    
    startCamera();
    
    return () => {
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, [step]);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Validate passwords match
      if (formData.password !== formData.confirmPassword) {
        throw new Error("Passwords do not match");
      }

      if (formData.password.length < 6) {
        throw new Error("Password must be at least 6 characters");
      }

      // 1. Create Firebase auth user
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        formData.email,
        formData.password
      );

      // 2. Get Firebase ID token
      const idToken = await userCredential.user.getIdToken();
      setToken(idToken);

      // 3. Register owner in backend database
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      console.log("Registering owner with Firebase UID:", userCredential.user.uid);
      try {
        const registerResponse = await axios.post(
          `${apiUrl}/auth/register-owner`,
          {
            email: formData.email,
            organization_name: formData.organizationName,
            uid: userCredential.user.uid,
          },
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }
        );
        console.log("Owner registration response:", registerResponse.data);
      } catch (registrationError) {
        console.error("Owner registration error:", registrationError);
        throw registrationError;
      }

      // Move to face capture step
      setStep("face");
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Signup failed";
      setError(errorMessage);
      console.error("Signup error:", err);
    } finally {
      setLoading(false);
    }
  }

  async function captureFace() {
    if (!videoRef.current || !canvasRef.current) return;
    
    setLoading(true);
    setError("");

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
          await axios.post(`${apiUrl}/auth/register-owner-face`, fd, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          
          // Set session cookie and redirect
          document.cookie = "session=1; path=/; max-age=3600; SameSite=Strict";
          router.replace("/");
        } catch (err) {
          console.error("Face capture error:", err);
          setError("Failed to register face. Please try again.");
          setLoading(false);
        }
      }, "image/jpeg");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to capture face";
      setError(errorMessage);
      setLoading(false);
    }
  }

  function skipFaceCapture() {
    document.cookie = "session=1; path=/; max-age=3600; SameSite=Strict";
    router.replace("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      {step === "form" ? (
        <div className="card w-full max-w-sm">
          <div className="mb-8 text-center">
            <div className="mb-3 text-4xl">🏢</div>
            <h1 className="text-2xl font-bold text-white">Create Account</h1>
            <p className="mt-1 text-sm text-slate-400">Register your organization</p>
          </div>

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="label">Organization Name</label>
              <input
                className="input"
                type="text"
                placeholder="Your Company Name"
                value={formData.organizationName}
                onChange={(e) =>
                  setFormData({ ...formData, organizationName: e.target.value })
                }
                required
              />
            </div>

            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                placeholder="owner@company.com"
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                required
              />
            </div>

            <div>
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                placeholder="••••••••"
                value={formData.password}
                onChange={(e) =>
                  setFormData({ ...formData, password: e.target.value })
                }
                required
              />
            </div>

            <div>
              <label className="label">Confirm Password</label>
              <input
                className="input"
                type="password"
                placeholder="••••••••"
                value={formData.confirmPassword}
                onChange={(e) =>
                  setFormData({ ...formData, confirmPassword: e.target.value })
                }
                required
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-900/40 p-3 text-sm text-red-300">
                {error}
              </p>
            )}

            <button
              className="btn-primary w-full"
              type="submit"
              disabled={loading}
            >
              {loading ? "Creating account…" : "Sign Up"}
            </button>
          </form>

          <div className="mt-6 border-t border-slate-700 pt-4 text-center">
            <p className="text-sm text-slate-400">
              Already have an account?{" "}
              <Link href="/login" className="text-blue-400 hover:text-blue-300">
                Sign In
              </Link>
            </p>
          </div>
        </div>
      ) : (
        <div className="card w-full max-w-sm">
          <div className="mb-8 text-center">
            <div className="mb-3 text-4xl">📸</div>
            <h1 className="text-2xl font-bold text-white">Capture Your Face</h1>
            <p className="mt-1 text-sm text-slate-400">This enables secure face-based authentication</p>
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

            {error && (
              <p className="rounded-lg bg-red-900/40 p-3 text-sm text-red-300">
                {error}
              </p>
            )}

            <button
              onClick={captureFace}
              disabled={loading}
              className="btn-primary w-full"
            >
              {loading ? "Capturing face…" : "Capture & Continue"}
            </button>

            <button
              onClick={skipFaceCapture}
              disabled={loading}
              className="w-full rounded-lg border border-slate-600 bg-slate-800/50 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              Skip for Now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
