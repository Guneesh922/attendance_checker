"use client";
import { useState, useCallback } from "react";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabase";

type Row = {
  id: string;
  date: string;
  entry_time: string | null;
  exit_time: string | null;
  is_late: boolean;
  employees: { name: string; role: string } | null;
};

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function hoursWorked(entry: string | null, exit: string | null): string {
  if (!entry || !exit) return "—";
  const diff = (new Date(exit).getTime() - new Date(entry).getTime()) / 3600000;
  return `${diff.toFixed(1)}h`;
}

export default function RecordsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setSearched(true);
    const { data } = await supabase()
      .from("attendance")
      .select("id, date, entry_time, exit_time, is_late, employees(name, role)")
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: false })
      .order("entry_time", { ascending: false });
    let result = (data as Row[]) ?? [];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((r) => r.employees?.name.toLowerCase().includes(q));
    }
    setRows(result);
    setLoading(false);
  }, [from, to, search]);

  function exportCsv() {
    const headers = ["Date", "Employee", "Role", "Entry", "Exit", "Hours", "Late"];
    const csvRows = rows.map((r) => [
      r.date,
      r.employees?.name ?? "",
      r.employees?.role ?? "",
      fmt(r.entry_time),
      fmt(r.exit_time),
      hoursWorked(r.entry_time, r.exit_time),
      r.is_late ? "Yes" : "No",
    ]);
    const csv = [headers, ...csvRows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `attendance_${from}_to_${to}.csv`;
    a.click();
  }

  return (
    <Layout>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Attendance Records</h1>
          <p className="mt-1 text-sm text-slate-400">Search and export historical attendance data</p>
        </div>
        {rows.length > 0 && (
          <button className="btn-ghost" onClick={exportCsv}>Export CSV</button>
        )}
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <label className="label">From</label>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="sm:col-span-1">
            <label className="label">Employee Name</label>
            <input
              className="input"
              placeholder="Filter by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
            />
          </div>
          <div className="flex items-end">
            <button className="btn-primary w-full" onClick={runSearch} disabled={loading}>
              {loading ? "Searching…" : "Search"}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {!searched ? (
        <div className="card flex flex-col items-center py-16 text-center">
          <p className="text-slate-500">Select a date range and click Search</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="card py-16 text-center">
          <p className="text-slate-400">No attendance records found for the selected criteria.</p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="border-b border-slate-800 px-6 py-3 text-xs text-slate-400">
            {rows.length} record{rows.length !== 1 ? "s" : ""} found
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                {["Date", "Employee", "Role", "Entry", "Exit", "Hours", "Status"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-slate-300">{r.date}</td>
                  <td className="px-5 py-3.5 font-medium text-white">{r.employees?.name ?? "—"}</td>
                  <td className="px-5 py-3.5 text-slate-400">{r.employees?.role ?? "—"}</td>
                  <td className="px-5 py-3.5 text-slate-300">{fmt(r.entry_time)}</td>
                  <td className="px-5 py-3.5 text-slate-300">{fmt(r.exit_time)}</td>
                  <td className="px-5 py-3.5 text-slate-400">{hoursWorked(r.entry_time, r.exit_time)}</td>
                  <td className="px-5 py-3.5">
                    {!r.entry_time ? (
                      <span className="badge-red">Absent</span>
                    ) : r.is_late ? (
                      <span className="badge-yellow">Late</span>
                    ) : (
                      <span className="badge-green">On Time</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
