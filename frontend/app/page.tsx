"use client";
import { useState, useEffect } from "react";
import Nav from "../components/Nav";
import { getToday } from "../lib/api";

type Row = { name: string; role: string; entry: string | null; exit: string | null };

export default function DashboardPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getToday()
      .then((r) => setRows(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const present = rows.length;
  const exited = rows.filter((r) => r.exit).length;
  const inside = present - exited;

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="mb-6 text-2xl font-bold text-white">Today&apos;s Dashboard</h1>

        {/* Stats strip */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          {[
            { label: "Checked In", value: present, color: "text-indigo-400" },
            { label: "Still Inside", value: inside, color: "text-amber-400" },
            { label: "Exited", value: exited, color: "text-emerald-400" },
          ].map((s) => (
            <div key={s.label} className="card text-center">
              <div className={`text-4xl font-bold ${s.color}`}>{s.value}</div>
              <div className="mt-1 text-xs text-slate-400">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="card overflow-hidden p-0">
          {loading ? (
            <p className="p-6 text-slate-400">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-slate-400">No attendance recorded today.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-indigo-600">
                <tr>{["Name","Role","Entry","Exit","Status"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-semibold text-white">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.name} className={i % 2 === 0 ? "bg-[#1a1f2e]" : "bg-[#1e2438]"}>
                    <td className="px-4 py-3 font-medium text-white">{r.name}</td>
                    <td className="px-4 py-3 text-slate-400">{r.role}</td>
                    <td className="px-4 py-3">{r.entry ?? "—"}</td>
                    <td className="px-4 py-3">{r.exit ?? "—"}</td>
                    <td className="px-4 py-3">
                      {r.exit
                        ? <span className="text-emerald-400 font-semibold">✅ Exited</span>
                        : <span className="text-amber-400 font-semibold">🟡 Inside</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </>
  );
}
