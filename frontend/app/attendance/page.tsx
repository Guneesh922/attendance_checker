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
  const [cameraActive, setCameraActive] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [todayRows, setTodayRows] = useState<Array<{ name: string; role: string; entry_time: string | null; exit_time: string | null }>>([]);
  // Tracks which detected faces have the exception panel open
  const [exceptionOpen, setExceptionOpen] = useState<Set<string>>(new Set());

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks what action was auto-taken per person this session
  const autoMarkedRef = useRef<Map<string, "entry" | "exit">>(new Map());

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

  // Always-on auto-mode: entry before 2 PM, exit after 2 PM
  useEffect(() => {
    if (!cameraActive) return;
    const isPastCutoff = new Date().getHours() >= 14;

    detected
      .filter((f) => f.name)
      .forEach(async (f) => {
        const name = f.name!;
        const already = autoMarkedRef.current.get(name);
        const todayRecord = todayRows.find((r) => r.name === name);

        if (!todayRecord?.entry_time) {
          // No entry yet — mark entry regardless of time
          if (already !== "entry") {
            autoMarkedRef.current.set(name, "entry");
            const ok = await markEntry(name);
            setStatus((s) => ({ ...s, [name]: ok ? "Entered" : "Already in" }));
            loadToday();
          }
        } else if (!todayRecord?.exit_time && isPastCutoff) {
          // Entry exists, no exit, past 2 PM — mark exit
          if (already !== "exit") {
            autoMarkedRef.current.set(name, "exit");
            const ok = await markExit(name);
            setStatus((s) => ({ ...s, [name]: ok ? "Exited" : "Already out" }));
            loadToday();
          }
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detected, cameraActive]);

  // Attach stream to video element once it mounts
  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraActive]);

  async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    });
    streamRef.current = stream;
    setCameraActive(true);
    startScanning();
  }

  function stopCamera() {
    stopScanning();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
    setDetected([]);
    setExceptionOpen(new Set());
    autoMarkedRef.current = new Map();
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  }

  function startScanning() {
    setScanning(true);
    intervalRef.current = setInterval(async () => {
      const video = videoRef.current;
      if (!video || faceApiStatus !== "ready" || !video.videoWidth) return;
      try {
        const MAX_W = 320;
        const scale = Math.min(1, MAX_W / video.videoWidth);
        const w = Math.round(video.videoWidth * scale);
        const h = Math.round(video.videoHeight * scale);
        const tmp = document.createElement("canvas");
        tmp.width = w; tmp.height = h;
        tmp.getContext("2d")!.drawImage(video, 0, 0, w, h);
        const faces = await detectAndMatch(tmp, employees);
        const upscaled = faces.map((f) => ({
          ...f,
          box: {
            top: f.box.top / scale, right: f.box.right / scale,
            bottom: f.box.bottom / scale, left: f.box.left / scale,
          },
        }));
        setDetected(upscaled);
      } catch { /* ignore single-frame errors */ }
    }, 1500);
  }

  function stopScanning() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setScanning(false);
  }

  useEffect(() => {
    if (cameraActive && scanning) { stopScanning(); startScanning(); }
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

  function toggleException(name: string) {
    setExceptionOpen((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  const recognizedNames = detected.filter((f) => f.name).map((f) => f.name!);
  const isPastCutoff = new Date().getHours() >= 14;

  return (
    <Layout>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Attendance Scanner</h1>
          <p className="mt-1 text-sm text-slate-400">
            {faceApiStatus === "ready"
              ? `${employees.length} employee${employees.length !== 1 ? "s" : ""} loaded · Auto-marking ${isPastCutoff ? "exits" : "entries"}`
              : faceApiStatus === "loading"
              ? "Loading face recognition…"
              : "Face recognition unavailable"}
          </p>
        </div>
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
                const name = face.name;
                const isExceptionOpen = exceptionOpen.has(name);
                return (
                  <div
                    key={`${name}-${i}`}
                    className="rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-white">{name}</p>
                        {status[name] && (
                          <p className="text-xs text-emerald-400">{status[name]}</p>
                        )}
                      </div>
                      {/* Exception button — for unusual situations only */}
                      <button
                        className="rounded-lg border border-amber-700/60 bg-amber-900/20 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-900/40 transition-colors"
                        onClick={() => toggleException(name)}
                      >
                        {isExceptionOpen ? "Cancel" : "Exception"}
                      </button>
                    </div>

                    {/* Exception panel: manual override */}
                    {isExceptionOpen && (
                      <div className="rounded-lg border border-amber-700/30 bg-amber-950/30 px-3 py-2.5 space-y-2">
                        <p className="text-xs text-amber-400 font-medium">
                          Manual override — use only when auto-detection is wrong
                        </p>
                        <div className="flex gap-2">
                          <button
                            className="btn-primary text-xs flex-1"
                            onClick={async () => {
                              autoMarkedRef.current.set(name, "entry");
                              const ok = await markEntry(name);
                              setStatus((s) => ({ ...s, [name]: ok ? "Entry overridden" : "Already entered" }));
                              toggleException(name);
                              loadToday();
                            }}
                          >
                            Force Entry
                          </button>
                          <button
                            className="btn-ghost text-xs flex-1"
                            onClick={async () => {
                              autoMarkedRef.current.set(name, "exit");
                              const ok = await markExit(name);
                              setStatus((s) => ({ ...s, [name]: ok ? "Exit overridden" : "No entry today" }));
                              toggleException(name);
                              loadToday();
                            }}
                          >
                            Force Exit
                          </button>
                        </div>
                      </div>
                    )}
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
