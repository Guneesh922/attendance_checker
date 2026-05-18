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
  monthly_salary: number | null;
  paid_leaves_pm: number;
  joining_date: string | null;
  displayPhotoUrl?: string;
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
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

  // New / edit shared form state
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [monthlySalary, setMonthlySalary] = useState("");
  const [paidLeavesPm, setPaidLeavesPm] = useState("");
  const [joiningDate, setJoiningDate] = useState("");

  // New employee — camera / photos
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const loadEmployees = useCallback(async () => {
    const db = supabase();
    const { data } = await db.from("employees").select("*").order("created_at");
    const rows = (data as Employee[]) ?? [];

    const withUrls = await Promise.all(
      rows.map(async (emp) => {
        if (!emp.photo_urls?.[0]) return emp;
        const { data: signed } = await db.storage
          .from("employee-photos")
          .createSignedUrl(emp.photo_urls[0], 3600);
        return { ...emp, displayPhotoUrl: signed?.signedUrl };
      })
    );

    setEmployees(withUrls);
    setLoading(false);
  }, []);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraActive]);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      });
      streamRef.current = stream;
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
    const MAX_W = 640;
    const scale = Math.min(1, MAX_W / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);

    const descriptor = await extractDescriptorFromCanvas(canvas);
    if (!descriptor) {
      setError("No face detected. Look directly at the camera and try again.");
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

      const nameSlug = name.trim().toLowerCase().replace(/\s+/g, "_");
      const ts = Date.now();
      const photoUrls = (
        await Promise.all(
          validPhotos.map(async (photo, i) => {
            const blob = await (await fetch(photo.dataUrl)).blob();
            const path = `${user.id}/${nameSlug}/${ts}_${i}.jpg`;
            const { error: upErr } = await db.storage.from("employee-photos").upload(path, blob);
            return upErr ? null : path;
          })
        )
      ).filter(Boolean) as string[];

      const { data: owner } = await db.from("owners").select("id").single();
      if (!owner) throw new Error("Owner record not found");

      const { error: insertErr } = await db.from("employees").insert({
        owner_id: owner.id,
        name: name.trim(),
        role: role.trim(),
        photo_urls: photoUrls,
        face_descriptors: validPhotos.map((p) => p.descriptor!),
        monthly_salary: monthlySalary ? parseFloat(monthlySalary) : null,
        paid_leaves_pm: paidLeavesPm ? parseInt(paidLeavesPm, 10) : 0,
        joining_date: joiningDate || null,
      });
      if (insertErr) throw insertErr;

      resetForm();
      setShowModal(false);
      loadEmployees();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save employee");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!editingEmployee) return;
    if (!role.trim()) return setError("Role cannot be empty.");

    setSaving(true);
    setError("");

    try {
      const db = supabase();
      const { error: updateErr } = await db.from("employees").update({
        role: role.trim(),
        monthly_salary: monthlySalary ? parseFloat(monthlySalary) : null,
        paid_leaves_pm: paidLeavesPm ? parseInt(paidLeavesPm, 10) : 0,
        joining_date: joiningDate || null,
      }).eq("id", editingEmployee.id);

      if (updateErr) throw updateErr;

      setEditingEmployee(null);
      resetForm();
      loadEmployees();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update employee");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEmployee(id: string, empName: string) {
    if (!confirm(`Delete ${empName}? This also removes their attendance records.`)) return;
    await supabase().from("employees").delete().eq("id", id);
    loadEmployees();
  }

  function resetForm() {
    setName(""); setRole(""); setMonthlySalary(""); setPaidLeavesPm("");
    setJoiningDate(""); setCapturedPhotos([]); setError("");
    stopCamera();
  }

  function openNewModal() {
    resetForm();
    setEditingEmployee(null);
    setShowModal(true);
  }

  function openEditModal(emp: Employee) {
    setEditingEmployee(emp);
    setName(emp.name);
    setRole(emp.role);
    setMonthlySalary(emp.monthly_salary != null ? String(emp.monthly_salary) : "");
    setPaidLeavesPm(emp.paid_leaves_pm ? String(emp.paid_leaves_pm) : "");
    setJoiningDate(emp.joining_date ?? "");
    setError("");
    setShowModal(true);
  }

  function closeModal() {
    resetForm();
    setEditingEmployee(null);
    setShowModal(false);
  }

  const isEditing = editingEmployee !== null;

  return (
    <Layout>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Employees</h1>
          <p className="mt-1 text-sm text-slate-400">{employees.length} registered</p>
        </div>
        <button className="btn-primary" onClick={openNewModal}>+ Add Employee</button>
      </div>

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

      {loading ? (
        <p className="text-slate-400">Loading…</p>
      ) : employees.length === 0 ? (
        <div className="card flex flex-col items-center py-16 text-center">
          <div className="mb-4 text-5xl text-slate-600">⊹</div>
          <p className="text-slate-300 font-medium">No employees yet</p>
          <p className="mt-1 text-sm text-slate-500">Add your first employee to get started.</p>
          <button className="btn-primary mt-6" onClick={openNewModal}>+ Add First Employee</button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {employees.map((emp) => (
            <div key={emp.id} className="card flex items-start gap-4">
              <div className="flex-shrink-0">
                {emp.displayPhotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={emp.displayPhotoUrl}
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
                {emp.monthly_salary != null && (
                  <p className="mt-1 text-xs text-emerald-400">
                    ₹{emp.monthly_salary.toLocaleString()}/mo
                  </p>
                )}
                {emp.joining_date && (
                  <p className="text-xs text-slate-500">
                    Joined {new Date(emp.joining_date).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                  </p>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  {emp.face_descriptors?.length ?? 0} face photo{(emp.face_descriptors?.length ?? 0) !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => openEditModal(emp)}
                  className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
                  title="Edit info"
                >
                  Edit
                </button>
                <button
                  onClick={() => deleteEmployee(emp.id, emp.name)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-red-900/30 hover:text-red-400 transition-colors"
                  title="Delete employee"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 sticky top-0 bg-slate-900 z-10">
              <h2 className="font-semibold text-white">
                {isEditing ? `Edit: ${editingEmployee!.name}` : "Register New Employee"}
              </h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="space-y-5 p-6">
              {/* Name + Role */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Full Name</label>
                  <input
                    className="input disabled:opacity-50"
                    placeholder="Alice Smith"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={isEditing}
                  />
                  {isEditing && (
                    <p className="mt-1 text-xs text-slate-500">Name cannot be changed</p>
                  )}
                </div>
                <div>
                  <label className="label">Role / Position</label>
                  <input
                    className="input"
                    placeholder="Engineer"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  />
                </div>
              </div>

              {/* Optional financial info */}
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Financial Info <span className="normal-case font-normal text-slate-500">(optional)</span>
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Monthly Salary</label>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      placeholder="e.g. 50000"
                      value={monthlySalary}
                      onChange={(e) => setMonthlySalary(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Paid Leaves / Month</label>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      max="31"
                      placeholder="e.g. 2"
                      value={paidLeavesPm}
                      onChange={(e) => setPaidLeavesPm(e.target.value)}
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <label className="label">Joining Date</label>
                  <input
                    className="input"
                    type="date"
                    value={joiningDate}
                    onChange={(e) => setJoiningDate(e.target.value)}
                  />
                </div>
              </div>

              {/* Camera section — only for new employees */}
              {!isEditing && (
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
                      <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-xl" />
                    </div>
                  )}

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
              )}

              {error && (
                <p className="rounded-lg bg-red-900/40 px-3 py-2.5 text-sm text-red-300">{error}</p>
              )}

              <div className="flex gap-3">
                <button className="btn-ghost flex-1" onClick={closeModal}>Cancel</button>
                <button
                  className="btn-primary flex-1"
                  onClick={isEditing ? saveEdit : saveEmployee}
                  disabled={saving || (!isEditing && capturedPhotos.filter((p) => p.descriptor).length < 2)}
                >
                  {saving ? "Saving…" : isEditing ? "Save Changes" : "Save Employee"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
