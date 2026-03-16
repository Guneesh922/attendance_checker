"use client";
import { useState, useEffect } from "react";
import { createUserWithEmailAndPassword, onAuthStateChanged } from "firebase/auth";
import { auth } from "../../lib/firebase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";

export default function SignupPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    organizationName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      if (u) router.replace("/");
    });
  }, [router]);

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
      const token = await userCredential.user.getIdToken();

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
              Authorization: `Bearer ${token}`,
            },
          }
        );
        console.log("Owner registration response:", registerResponse.data);
      } catch (registrationError) {
        console.error("Owner registration error:", registrationError);
        throw registrationError;
      }

      // Set session cookie
      document.cookie = "session=1; path=/; max-age=3600; SameSite=Strict";
      
      // Redirect to dashboard
      router.replace("/");
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Signup failed";
      setError(errorMessage);
      console.error("Signup error:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
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
    </div>
  );
}
