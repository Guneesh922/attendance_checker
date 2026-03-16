"use client";
import { useState } from "react";
import Nav from "../../components/Nav";
import { useCamera } from "../../hooks/useCamera";
import { useRecognition } from "../../hooks/useRecognition";
import { markEntry, markExit } from "../../lib/api";

export default function AttendancePage() {
  const { videoRef, active, startCamera, stopCamera, captureBase64 } = useCamera();
  const { detected, start: startRecog, stop: stopRecog } = useRecognition(captureBase64);
  const [status, setStatus] = useState<Record<string, string>>({});

  async function handleStart() {
    await startCamera();
    startRecog();
  }
  function handleStop() {
    stopCamera();
    stopRecog();
  }

  async function handleEntry(name: string) {
    try {
      const { data } = await markEntry(name);
      setStatus((s) => ({ ...s, [name]: data.ok ? `✅ Entry marked` : `ℹ️ Already entered today` }));
    } catch { setStatus((s) => ({ ...s, [name]: "❌ Error" })); }
  }
  async function handleExit(name: string) {
    try {
      const { data } = await markExit(name);
      setStatus((s) => ({ ...s, [name]: data.ok ? `✅ Exit marked` : `ℹ️ No open entry found` }));
    } catch { setStatus((s) => ({ ...s, [name]: "❌ Error" })); }
  }

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-3xl p-6 space-y-6">
        <h1 className="text-2xl font-bold text-white">Mark Attendance</h1>

        <div className="card space-y-4">
          <div className="flex gap-3">
            {!active
              ? <button id="start-cam-btn" className="btn-primary" onClick={handleStart}>Start Camera</button>
              : <button id="stop-cam-btn" className="btn-ghost" onClick={handleStop}>Stop Camera</button>}
          </div>
          <video ref={videoRef} autoPlay playsInline className="w-full rounded-xl" />

          {active && detected.length === 0 && (
            <p className="text-sm text-slate-400 animate-pulse">Scanning… point face at camera</p>
          )}

          {detected.map((name) => (
            <div key={name} className="flex items-center justify-between rounded-xl border border-[#2a3147] bg-[#0f1117] px-4 py-3">
              <span className="font-semibold text-white">{name}</span>
              <div className="flex items-center gap-3">
                {status[name] && <span className="text-xs text-slate-300">{status[name]}</span>}
                <button id={`entry-${name}`} className="btn-primary text-xs" onClick={() => handleEntry(name)}>Entering</button>
                <button id={`exit-${name}`} className="btn-ghost text-xs" onClick={() => handleExit(name)}>Leaving</button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
