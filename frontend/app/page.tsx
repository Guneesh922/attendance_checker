"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import Layout from "../components/Layout";
import { supabase } from "../lib/supabase";

type AttendanceRow = {
  id: string;
  entry_time: string | null;
  exit_time: string | null;
  is_late: boolean;
  employees: { name: string; role: string } | null;
};

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function DashboardPage() {
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(true);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    async function load() {
      const db = supabase();
      const [attRes, empRes, ownerRes] = await Promise.all([
        db
          .from("attendance")
          .select("id, entry_time, exit_time, is_late, employees(name, role)")
          .eq("date", today)
          .order("entry_time", { ascending: false }),
        db.from("employees").select("id", { count: "exact", head: true }),
        db.from("owners").select("org_name").single(),
      ]);
      setRows((attRes.data as AttendanceRow[]) ?? []);
      setTotalEmployees(empRes.count ?? 0);
      setOrgName(ownerRes.data?.org_name ?? "");
      setLoading(false);
    }
    load();
  }, [today]);

  const present = rows.filter((r) => r.entry_time).length;
  const exited = rows.filter((r) => r.exit_time).length;
  const late = rows.filter((r) => r.is_late).length;
  const absent = Math.max(0, totalEmployees - present);

  const stats = [
    { label: "Total Employees", value: totalEmployees, color: "text-slate-200",   bg: "bg-slate-800/50" },
    { label: "Present Today",   value: present,        color: "text-emerald-400", bg: "bg-emerald-900/20" },
    { label: "Late Today",      value: late,           color: "text-amber-400",   bg: "bg-amber-900/20"  },
    { label: "Absent Today",    value: absent,         color: "text-red-400",     bg: "bg-red-900/20"    },
  ];

  return (
    <Layout>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {orgName || "Dashboard"}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long", year: "numeric", month: "long", day: "numeric",
            })}
          </p>
        </div>
        <Link href="/attendance" className="btn-primary">Open Scanner</Link>
      </div>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className={`rounded-xl border border-slate-800 ${s.bg} p-5`}>
            <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
            <div className="mt-1 text-xs font-medium text-slate-400">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Today's attendance table */}
      <div className="card overflow-hidden p-0">
        <div className="border-b border-slate-800 px-6 py-4">
          <h2 className="font-semibold text-white">Today&apos;s Attendance</h2>
        </div>
        {loading ? (
          <p className="px-6 py-8 text-sm text-slate-400">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-slate-400">No attendance recorded today.</p>
            <Link href="/attendance" className="mt-4 inline-block text-sm text-indigo-400 hover:text-indigo-300">
              Open the scanner →
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                {["Employee", "Role", "Entry", "Exit", "Status"].map((h) => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-6 py-3.5 font-medium text-white">{r.employees?.name ?? "—"}</td>
                  <td className="px-6 py-3.5 text-slate-400">{r.employees?.role ?? "—"}</td>
                  <td className="px-6 py-3.5 text-slate-300">{fmt(r.entry_time)}</td>
                  <td className="px-6 py-3.5 text-slate-300">{fmt(r.exit_time)}</td>
                  <td className="px-6 py-3.5">
                    {r.exit_time
                      ? <span className="badge-gray">Exited</span>
                      : r.is_late
                      ? <span className="badge-yellow">Late</span>
                      : <span className="badge-green">Present</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
