"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabase";
import { useFaceApi, extractDescriptorFromCanvas } from "../../hooks/useFaceApi";

type Employee = {
  id: string;
  name: string;
  role: string;
  photo_urls: string[];
  face_descriptors: number[][];
  created_at: string;
};

type CapturedPhoto = {
  dataUrl: string;
  descriptor: number[] | null;
};

export default function EmployeesPage() {
  const faceApiStatus = useFaceApi();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const loadEmployees = useCallback(async () => {
    const { data } = await supabase().from("employees").select("*").order("created_at");
    setEmployees((data as Employee[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch {
      setError("Could not access camera. Check browser permissions.");
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  }

  async function capturePhoto() {
    if (!videoRef.current || faceApiStatus !== "ready") return;
    setError("");

    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);

    const descriptor = await extractDescriptorFromCanvas(canvas);
    if (!descriptor) {
      setError("No face detected in this photo. Please look directly at the camera and try again.");
      return;
    }

    setCapturedPhotos((prev) => [
      ...prev,
      { dataUrl: canvas.toDataURL("image/jpeg", 0.8), descriptor },
    ]);
  }

  async function saveEmployee() {
    if (!name.trim()) return setError("Please enter a name.");
    if (!role.trim()) return setError("Please enter a role.");
    const validPhotos = capturedPhotos.filter((p) => p.descriptor);
    if (validPhotos.length < 2) return setError("Capture at least 2 clear face photos.");

    setSaving(true);
    setError("");

    try {
      const db = supabase();
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Upload photos to Supabase Storage
      const photoUrls: string[] = [];
      for (let i = 0; i < validPhotos.length; i++) {
        const photo = validPhotos[i];
        const blob = await (await fetch(photo.dataUrl)).blob();
        const path = `${user.id}/${name.trim().toLowerCase().replace(/\s+/g, "_")}/${Date.now()}_${i}.jpg`;
        const { error: upErr } = await db.storage.from("employee-photos").upload(path, blob);
        if (!upErr) {
          const { data: { publicUrl } } = db.storage.from("employee-photos").getPublicUrl(path);
          photoUrls.push(publicUrl);
        }
      }

      // Get owner record
      const { data: owner } = await db.from("owners").select("id").single();
      if (!owner) throw new Error("Owner record not found");

      // Insert employee
      const { error: insertErr } = await db.from("employees").insert({
        owner_id: owner.id,
        name: name.trim(),
        role: role.trim(),
        photo_urls: photoUrls,
        face_descriptors: validPhotos.map((p) => p.descriptor!),
      });
      if (insertErr) throw insertErr;

      // Reset and close
      setName(""); setRole(""); setCapturedPhotos([]);
      stopCamera();
      setShowModal(false);
      loadEmployees();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save employee");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEmployee(id: string, empName: string) {
    if (!confirm(`Delete ${empName}? This also removes their attendance records.`)) return;
    await supabase().from("employees").delete().eq("id", id);
    loadEmployees();
  }

  function openModal() {
    setName(""); setRole(""); setCapturedPhotos([]); setError("");
    setShowModal(true);
  }

  function closeModal() {
    stopCamera();
    setShowModal(false);
  }

  return (
    <Layout>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Employees</h1>
          <p className="mt-1 text-sm text-slate-400">{employees.length} registered</p>
        </div>
        <button className="btn-primary" onClick={openModal}>+ Add Employee</button>
      </div>

      {/* Face API status banner */}
      {faceApiStatus === "loading" && (
        <div className="mb-6 rounded-lg border border-indigo-700/50 bg-indigo-900/20 px-4 py-3 text-sm text-indigo-300">
          Loading face recognition models… (first load may take ~10 seconds)
        </div>
      )}
      {faceApiStatus === "error" && (
        <div className="mb-6 rounded-lg border border-red-700/50 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          Failed to load face recognition models. Check your internet connection and reload.
        </div>
      )}

      {/* Employee grid */}
      {loading ? (
        <p className="text-slate-400">Loading…</p>
      ) : employees.length === 0 ? (
        <div className="card flex flex-col items-center py-16 text-center">
          <div className="mb-4 text-5xl text-slate-600">⊹</div>
          <p className="text-slate-300 font-medium">No employees yet</p>
          <p className="mt-1 text-sm text-slate-500">Add your first employee to get started with attendance tracking.</p>
          <button className="btn-primary mt-6" onClick={openModal}>+ Add First Employee</button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {employees.map((emp) => (
            <div key={emp.id} className="card flex items-start gap-4">
              {/* Avatar / photo */}
              <div className="flex-shrink-0">
                {emp.photo_urls?.[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={emp.photo_urls[0]}
                    alt={emp.name}
                    className="h-14 w-14 rounded-full object-cover ring-2 ring-slate-700"
                  />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-900/50 text-xl font-bold text-indigo-300">
                    {emp.name[0].toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate">{emp.name}</p>
                <p className="text-sm text-slate-400">{emp.role}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {emp.face_descriptors?.length ?? 0} face photo{(emp.face_descriptors?.length ?? 0) !== 1 ? "s" : ""}
                </p>
              </div>
              <button
                onClick={() => deleteEmployee(emp.id, emp.name)}
                className="flex-shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-red-900/30 hover:text-red-400 transition-colors"
                title="Delete employee"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add Employee Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <h2 className="font-semibold text-white">Register New Employee</h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="space-y-5 p-6">
              {/* Name + Role */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Full Name</label>
                  <input className="input" placeholder="Alice Smith" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <label className="label">Role / Position</label>
                  <input className="input" placeholder="Engineer" value={role} onChange={(e) => setRole(e.target.value)} />
                </div>
              </div>

              {/* Camera */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="label mb-0">
                    Face Photos
                    <span className="ml-2 font-normal normal-case text-slate-500">
                      ({capturedPhotos.length}/3 captured — need at least 2)
                    </span>
                  </label>
                  {!cameraActive ? (
                    <button
                      className="btn-secondary text-xs"
                      onClick={startCamera}
                      disabled={faceApiStatus !== "ready"}
                    >
                      {faceApiStatus === "loading" ? "Loading models…" : "Start Camera"}
                    </button>
                  ) : (
                    <button className="btn-ghost text-xs" onClick={stopCamera}>Stop Camera</button>
                  )}
                </div>

                {cameraActive && (
                  <div className="relative overflow-hidden rounded-xl bg-black">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full rounded-xl"
                    />
                  </div>
                )}

                {/* Thumbnails */}
                {capturedPhotos.length > 0 && (
                  <div className="mt-3 flex gap-2">
                    {capturedPhotos.map((p, i) => (
                      <div key={i} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.dataUrl} alt="" className="h-16 w-16 rounded-lg object-cover ring-2 ring-emerald-500" />
                        <button
                          onClick={() => setCapturedPhotos((prev) => prev.filter((_, j) => j !== i))}
                          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[9px] text-white"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {cameraActive && capturedPhotos.length < 3 && (
                  <button
                    className="btn-primary mt-3 w-full"
                    onClick={capturePhoto}
                    disabled={faceApiStatus !== "ready"}
                  >
                    Take Photo {capturedPhotos.length + 1}
                  </button>
                )}
              </div>

              {error && (
                <p className="rounded-lg bg-red-900/40 px-3 py-2.5 text-sm text-red-300">{error}</p>
              )}

              <div className="flex gap-3">
                <button className="btn-ghost flex-1" onClick={closeModal}>Cancel</button>
                <button
                  className="btn-primary flex-1"
                  onClick={saveEmployee}
                  disabled={saving || capturedPhotos.filter((p) => p.descriptor).length < 2}
                >
                  {saving ? "Saving…" : "Save Employee"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
