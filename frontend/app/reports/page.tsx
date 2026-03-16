"use client";
import { useState } from "react";
import Nav from "../../components/Nav";
import { getByDate, getByMonth, getIrregulars, sendReport, csvUrl } from "../../lib/api";
import { auth } from "../../lib/firebase";

type Row = Record<string, string | null>;

export default function ReportsPage() {
  const now = new Date();
  const [date, setDate] = useState(now.toISOString().slice(0, 10));
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [rows, setRows] = useState<Row[]>([]);
  const [irregulars, setIrregulars] = useState<Row[]>([]);
  const [tab, setTab] = useState<"date" | "month" | "irregular">("date");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  async function search() {
    setLoading(true); setMsg("");
    try {
      if (tab === "date") {
        const r = await getByDate(date);
        setRows(r.data);
      } else if (tab === "month") {
        const r = await getByMonth(year, month);
        setRows(r.data);
      } else {
        const r = await getIrregulars(year, month);
        setIrregulars(r.data);
      }
    } catch { setMsg("Failed to load data"); }
    finally { setLoading(false); }
  }

  async function handleSendReport() {
    try {
      await sendReport();
      setMsg("✅ Report sent!");
    } catch { setMsg("❌ Send failed — check email settings"); }
  }

  async function downloadCsv() {
    const token = await auth.currentUser?.getIdToken();
    const params = tab === "date" ? `date=${date}` : `year=${year}&month=${month}`;
    const url = csvUrl(params);
    const a = document.createElement("a");
    a.href = url;
    a.download = "attendance.csv";
    // Fetch with auth header and create object URL
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const blob = await res.blob();
    a.href = URL.createObjectURL(blob);
    a.click();
  }

  const displayRows = tab === "irregular" ? irregulars : rows;
  const headers = tab === "date" ? ["Name","Role","Entry","Exit"]
    : tab === "month" ? ["Name","Role","Date","Entry","Exit"]
    : ["Name","Role","Absent Days","Late Days","Irregular Dates"];

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-5xl p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Reports</h1>
          <div className="flex gap-2">
            <button className="btn-ghost text-xs" onClick={downloadCsv}>⬇ Export CSV</button>
            <button id="send-report-btn" className="btn-primary text-xs" onClick={handleSendReport}>Send Email Report</button>
          </div>
        </div>
        {msg && <p className="text-sm text-slate-300">{msg}</p>}

        {/* Tab bar */}
        <div className="flex gap-2">
          {(["date","month","irregular"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === t ? "bg-indigo-600 text-white" : "btn-ghost"}`}>
              {t === "date" ? "By Date" : t === "month" ? "By Month" : "Irregulars"}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="card flex items-end gap-4">
          {tab === "date" ? (
            <div className="flex-1">
              <label className="label">Date</label>
              <input id="date-input" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          ) : (
            <>
              <div>
                <label className="label">Year</label>
                <input id="year-input" className="input w-24" type="number" value={year} onChange={(e) => setYear(+e.target.value)} />
              </div>
              <div>
                <label className="label">Month</label>
                <input id="month-input" className="input w-20" type="number" min={1} max={12} value={month} onChange={(e) => setMonth(+e.target.value)} />
              </div>
            </>
          )}
          <button id="search-btn" className="btn-primary" onClick={search} disabled={loading}>
            {loading ? "Loading…" : "Search"}
          </button>
        </div>

        {/* Results table */}
        {displayRows.length > 0 && (
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="bg-indigo-600">
                <tr>{headers.map((h) => <th key={h} className="px-4 py-3 text-left font-semibold text-white">{h}</th>)}</tr>
              </thead>
              <tbody>
                {displayRows.map((r, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-[#1a1f2e]" : "bg-[#1e2438]"}>
                    {Object.values(r).map((v, j) => (
                      <td key={j} className="px-4 py-3">{v ?? "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
