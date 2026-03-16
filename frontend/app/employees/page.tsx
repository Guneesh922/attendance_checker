"use client";
import { useState, useEffect, useCallback } from "react";
import Nav from "../../components/Nav";
import { useCamera } from "../../hooks/useCamera";
import { listEmployees, registerEmployee, addFaceImage, deleteEmployee } from "../../lib/api";

type Employee = { name: string; role: string };

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [addImageTarget, setAddImageTarget] = useState("");
  const { videoRef, active, startCamera, stopCamera, captureBlob } = useCamera();

  const load = useCallback(() =>
    listEmployees().then((r) => setEmployees(r.data)).catch(console.error), []);
  useEffect(() => { load(); }, [load]);

  async function handleRegister() {
    if (!name || !role || !active) return setStatus("Fill name, role and start camera first.");
    try {
      setStatus("Capturing…");
      const blob = await captureBlob();
      await registerEmployee(name, role, blob);
      setStatus(`✅ ${name} registered!`);
      setName(""); setRole("");
      stopCamera(); load();
    } catch (e: unknown) {
      setStatus(`❌ ${e instanceof Error ? e.message : "Error"}`);
    }
  }

  async function handleAddImage(empName: string) {
    if (!active) return setStatus("Start camera first.");
    try {
      const blob = await captureBlob();
      await addFaceImage(empName, blob);
      setStatus(`✅ Extra image added for ${empName}`);
      setAddImageTarget("");
    } catch (e: unknown) {
      setStatus(`❌ ${e instanceof Error ? e.message : "Error"}`);
    }
  }

  async function handleDelete(empName: string) {
    if (!confirm(`Delete ${empName}? This removes all their attendance records.`)) return;
    try {
      await deleteEmployee(empName);
      load();
      setStatus(`Deleted ${empName}`);
    } catch (e: unknown) {
      setStatus(`❌ ${e instanceof Error ? e.message : "Error"}`);
    }
  }

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-5xl p-6 space-y-6">
        <h1 className="text-2xl font-bold text-white">Employees</h1>

        {/* Register form */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-white">Register New Employee</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Name</label>
              <input id="emp-name" className="input" placeholder="Alice" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label">Role</label>
              <input id="emp-role" className="input" placeholder="Engineer" value={role} onChange={(e) => setRole(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-3">
            {!active
              ? <button id="start-cam-btn" className="btn-primary" onClick={startCamera}>Start Camera</button>
              : <button id="stop-cam-btn" className="btn-ghost" onClick={stopCamera}>Stop Camera</button>}
            <button id="register-btn" className="btn-primary" onClick={handleRegister} disabled={!active}>Capture &amp; Register</button>
          </div>
          <video ref={videoRef} autoPlay playsInline className="w-full max-w-sm rounded-xl" />
          {status && <p className="text-sm text-slate-300">{status}</p>}
        </div>

        {/* Employee list */}
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-indigo-600">
              <tr>{["Name","Role","Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-semibold text-white">{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {employees.map((emp, i) => (
                <tr key={emp.name} className={i % 2 === 0 ? "bg-[#1a1f2e]" : "bg-[#1e2438]"}>
                  <td className="px-4 py-3 font-medium text-white">{emp.name}</td>
                  <td className="px-4 py-3 text-slate-400">{emp.role}</td>
                  <td className="px-4 py-3 flex gap-2">
                    <button className="btn-ghost text-xs"
                      onClick={() => { setAddImageTarget(emp.name); startCamera(); }}>
                      + Image
                    </button>
                    {addImageTarget === emp.name && active && (
                      <button className="btn-primary text-xs" onClick={() => handleAddImage(emp.name)}>
                        Capture
                      </button>
                    )}
                    <button className="btn-danger text-xs" onClick={() => handleDelete(emp.name)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
