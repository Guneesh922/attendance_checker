"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabase";
import { useFaceApi, detectAndMatch, DetectedFace } from "../../hooks/useFaceApi";

type Employee = { id: string; name: string; role: string; face_descriptors: number[][] };
type AttendanceStatus = { [name: string]: string };

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function AttendancePage() {
  const faceApiStatus = useFaceApi();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [detected, setDetected] = useState<DetectedFace[]>([]);
  const [status, setStatus] = useState<AttendanceStatus>({});
  const [autoMode, setAutoMode] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [todayRows, setTodayRows] = useState<Array<{ name: string; role: string; entry_time: string | null; exit_time: string | null }>>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoMarkedRef = useRef<Set<string>>(new Set());

  const loadEmployees = useCallback(async () => {
    const { data } = await supabase().from("employees").select("id, name, role, face_descriptors");
    setEmployees((data as Employee[]) ?? []);
  }, []);

  const loadToday = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabase()
      .from("attendance")
      .select("entry_time, exit_time, employees(name, role)")
      .eq("date", today)
      .order("entry_time", { ascending: false });
    if (data) {
      setTodayRows(
        data.map((r: any) => ({
          name: r.employees?.name ?? "Unknown",
          role: r.employees?.role ?? "",
          entry_time: r.entry_time,
          exit_time: r.exit_time,
        }))
      );
    }
  }, []);

  useEffect(() => {
    loadEmployees();
    loadToday();
  }, [loadEmployees, loadToday]);

  // Draw face bounding boxes on canvas overlay
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    canvas.width = video.clientWidth;
    canvas.height = video.clientHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!detected.length || !video.videoWidth) return;

    const sx = video.clientWidth / video.videoWidth;
    const sy = video.clientHeight / video.videoHeight;

    for (const face of detected) {
      const { top, right, bottom, left } = face.box;
      const x = left * sx, y = top * sy;
      const w = (right - left) * sx, h = (bottom - top) * sy;
      const label = face.name ?? "Unknown";
      const color = face.name ? "#10b981" : "#ef4444";

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      ctx.font = "bold 13px Inter, sans-serif";
      const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = color;
      ctx.fillRect(x, y - 24, tw, 24);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, x + 6, y - 7);
    }
  }, [detected]);

  // Auto-mode: mark entry once per session per person
  useEffect(() => {
    if (!autoMode) return;
    detected
      .filter((f) => f.name && !autoMarkedRef.current.has(f.name))
      .forEach(async (f) => {
        if (!f.name) return;
        autoMarkedRef.current.add(f.name);
        const ok = await markEntry(f.name);
        setStatus((s) => ({ ...s, [f.name!]: ok ? "Auto-entered" : "Already in" }));
        loadToday();
      });
  }, [detected, autoMode, loadToday]);

  async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    });
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
    setCameraActive(true);
    startScanning();
  }

  function stopCamera() {
    stopScanning();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
    setDetected([]);
    autoMarkedRef.current.clear();
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  }

  function startScanning() {
    setScanning(true);
    intervalRef.current = setInterval(async () => {
      if (!videoRef.current || faceApiStatus !== "ready") return;
      try {
        const faces = await detectAndMatch(videoRef.current, employees);
        setDetected(faces);
      } catch { /* ignore single-frame errors */ }
    }, 1500);
  }

  function stopScanning() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setScanning(false);
  }

  // Re-start scanning when employees load (so matcher has data)
  useEffect(() => {
    if (cameraActive && scanning) {
      stopScanning();
      startScanning();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees]);

  async function markEntry(empName: string): Promise<boolean> {
    const db = supabase();
    const today = new Date().toISOString().slice(0, 10);
    const { data: owner } = await db.from("owners").select("id").single();
    const { data: emp } = await db.from("employees").select("id").eq("name", empName).single();
    if (!owner || !emp) return false;

    const { data: settings } = await db.from("settings").select("arrival_time").eq("owner_id", owner.id).single();
    const arrivalTime = settings?.arrival_time ?? "09:00:00";
    const now = new Date();
    const [h, m] = arrivalTime.split(":").map(Number);
    const isLate = now.getHours() > h || (now.getHours() === h && now.getMinutes() > m);

    const { error } = await db.from("attendance").upsert(
      { employee_id: emp.id, owner_id: owner.id, date: today, entry_time: now.toISOString(), is_late: isLate },
      { onConflict: "employee_id,date", ignoreDuplicates: true }
    );
    return !error;
  }

  async function markExit(empName: string): Promise<boolean> {
    const db = supabase();
    const today = new Date().toISOString().slice(0, 10);
    const { data: emp } = await db.from("employees").select("id").eq("name", empName).single();
    if (!emp) return false;
    const { error } = await db.from("attendance")
      .update({ exit_time: new Date().toISOString() })
      .eq("employee_id", emp.id)
      .eq("date", today);
    return !error;
  }

  const recognizedNames = detected.filter((f) => f.name).map((f) => f.name!);

  return (
    <Layout>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Attendance Scanner</h1>
          <p className="mt-1 text-sm text-slate-400">
            {faceApiStatus === "ready"
              ? `${employees.length} employee${employees.length !== 1 ? "s" : ""} loaded`
              : faceApiStatus === "loading"
              ? "Loading face recognition…"
              : "Face recognition unavailable"}
          </p>
        </div>
        {cameraActive && (
          <label className="flex cursor-pointer items-center gap-2.5">
            <span className="text-sm text-slate-300">Auto-mode</span>
            <button
              role="switch"
              aria-checked={autoMode}
              onClick={() => setAutoMode((v) => !v)}
              className={`relative h-6 w-11 rounded-full transition-colors ${autoMode ? "bg-indigo-600" : "bg-slate-700"}`}
            >
              <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${autoMode ? "translate-x-5" : ""}`} />
            </button>
          </label>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Camera panel */}
        <div className="card space-y-4">
          <div className="flex gap-3">
            {!cameraActive ? (
              <button
                className="btn-primary"
                onClick={startCamera}
                disabled={faceApiStatus !== "ready"}
              >
                {faceApiStatus === "loading" ? "Loading models…" : "Start Camera"}
              </button>
            ) : (
              <button className="btn-ghost" onClick={stopCamera}>Stop Camera</button>
            )}
          </div>

          {cameraActive && (
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-xl" />
              <canvas ref={canvasRef} className="absolute inset-0 rounded-xl pointer-events-none" />
            </div>
          )}

          {!cameraActive && (
            <div className="flex h-48 items-center justify-center rounded-xl border-2 border-dashed border-slate-800 text-slate-600">
              Camera off
            </div>
          )}

          {cameraActive && detected.length === 0 && (
            <p className="animate-pulse text-sm text-slate-400">Scanning… point faces at camera</p>
          )}

          {/* Detected faces */}
          {recognizedNames.length > 0 && (
            <div className="space-y-2">
              {detected.map((face, i) => {
                if (!face.name) return null;
                return (
                  <div
                    key={`${face.name}-${i}`}
                    className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3"
                  >
                    <div>
                      <p className="font-semibold text-white">{face.name}</p>
                      {status[face.name] && (
                        <p className="text-xs text-slate-400">{status[face.name]}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {!autoMode && (
                        <button
                          className="btn-primary text-xs"
                          onClick={async () => {
                            const ok = await markEntry(face.name!);
                            setStatus((s) => ({ ...s, [face.name!]: ok ? "Entry marked" : "Already entered" }));
                            loadToday();
                          }}
                        >
                          Entering
                        </button>
                      )}
                      <button
                        className="btn-ghost text-xs"
                        onClick={async () => {
                          const ok = await markExit(face.name!);
                          setStatus((s) => ({ ...s, [face.name!]: ok ? "Exit marked" : "No entry today" }));
                          loadToday();
                        }}
                      >
                        Leaving
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Today's log */}
        <div className="card overflow-hidden p-0">
          <div className="border-b border-slate-800 px-5 py-4">
            <h2 className="font-semibold text-white">Today&apos;s Log</h2>
          </div>
          {todayRows.length === 0 ? (
            <p className="px-5 py-8 text-sm text-slate-500">No entries yet today.</p>
          ) : (
            <div className="divide-y divide-slate-800">
              {todayRows.map((r, i) => (
                <div key={i} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="font-medium text-white">{r.name}</p>
                    <p className="text-xs text-slate-500">{r.role}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="text-slate-300">{fmt(r.entry_time)}</p>
                    {r.exit_time && <p className="text-slate-500 text-xs">{fmt(r.exit_time)}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
