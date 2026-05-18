"use client";
import { useState, useEffect, useCallback } from "react";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabase";

// ─── shared types ──────────────────────────────────────────────────────────────

type Employee = {
  id: string;
  name: string;
  role: string;
  monthly_salary: number | null;
  paid_leaves_pm: number;
  joining_date: string | null;
};

type AttendanceRecord = {
  employee_id: string;
  date: string;
  entry_time: string | null;
  exit_time: string | null;
  is_late: boolean;
  employees?: { name: string; role: string } | null;
};

type MonthlyReport = {
  employeeId: string;
  name: string;
  role: string;
  daysPresent: number;
  daysAbsent: number;
  daysLate: number;
  earlyExits: number;
  paidLeavesUsed: number;
  unpaidAbsences: number;
  baseSalary: number | null;
  deductions: number;
  netSalary: number | null;
  flags: string[];
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtTime(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });
}

function money(n: number | null) {
  if (n == null) return "—";
  return `₹${Math.round(n).toLocaleString()}`;
}

function weekdaysBetween(startStr: string, endStr: string): number {
  const start = new Date(startStr + "T00:00:00");
  const end   = new Date(endStr   + "T00:00:00");
  if (start > end) return 0;
  let count = 0;
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

// ─── password gate ─────────────────────────────────────────────────────────────

function PasswordGate({ onVerified }: { onVerified: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isOAuth, setIsOAuth] = useState(false);

  useEffect(() => {
    supabase().auth.getUser().then(({ data }) => {
      const identities = data.user?.identities ?? [];
      if (identities.length > 0 && !identities.some((i) => i.provider === "email")) {
        setIsOAuth(true);
      }
    });
  }, []);

  async function verify() {
    if (!password.trim()) return;
    setLoading(true);
    setError("");
    try {
      const { data: { user } } = await supabase().auth.getUser();
      if (!user?.email) throw new Error("No email on account");
      const { error: authErr } = await supabase().auth.signInWithPassword({
        email: user.email,
        password,
      });
      if (authErr) throw new Error("Incorrect password. Try again.");
      onVerified();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-900/50 text-2xl">🔒</div>
          <h2 className="text-xl font-bold text-white">Reports</h2>
          <p className="mt-1 text-sm text-slate-400">
            {isOAuth ? "Signed in with Google — click to continue." : "Enter your account password to view reports."}
          </p>
        </div>
        {isOAuth ? (
          <button className="btn-primary w-full" onClick={onVerified}>Continue</button>
        ) : (
          <div className="card space-y-4">
            <input
              className="input"
              type="password"
              placeholder="Your login password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && verify()}
              autoFocus
            />
            {error && <p className="rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-300">{error}</p>}
            <button className="btn-primary w-full" onClick={verify} disabled={loading || !password.trim()}>
              {loading ? "Verifying…" : "Unlock Reports"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── main page ─────────────────────────────────────────────────────────────────

type Tab = "today" | "monthly" | "search";

export default function ReportsPage() {
  const [verified, setVerified] = useState(false);
  const [tab, setTab] = useState<Tab>("today");

  if (!verified) {
    return (
      <Layout>
        <PasswordGate onVerified={() => setVerified(true)} />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Reports</h1>
        <p className="mt-1 text-sm text-slate-400">Attendance irregularities, salary deductions, and history</p>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-xl border border-slate-800 bg-slate-900/60 p-1 w-fit">
        {([
          { id: "today",   label: "Today" },
          { id: "monthly", label: "Monthly" },
          { id: "search",  label: "Search & Cleanup" },
        ] as { id: Tab; label: string }[]).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-lg px-5 py-2 text-sm font-medium transition-colors ${
              tab === id ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "today"   && <TodayTab />}
      {tab === "monthly" && <MonthlyTab />}
      {tab === "search"  && <SearchTab />}
    </Layout>
  );
}

// ─── TODAY TAB ────────────────────────────────────────────────────────────────

function TodayTab() {
  const [lateArrivals, setLateArrivals]   = useState<AttendanceRecord[]>([]);
  const [earlyExits,   setEarlyExits]     = useState<AttendanceRecord[]>([]);
  const [absent,       setAbsent]         = useState<Employee[]>([]);
  const [loading,      setLoading]        = useState(true);

  useEffect(() => {
    async function load() {
      const db = supabase();
      const today = new Date().toISOString().slice(0, 10);

      const [ownerRes, empRes] = await Promise.all([
        db.from("owners").select("id").single(),
        db.from("employees").select("id, name, role, monthly_salary, paid_leaves_pm, joining_date"),
      ]);

      const settingsRes = ownerRes.data
        ? await db.from("settings").select("arrival_time, departure_time")
            .eq("owner_id", ownerRes.data.id).single()
        : null;

      const [depH, depM] = (settingsRes?.data?.departure_time ?? "17:00").split(":").map(Number);
      const departureMins = depH * 60 + depM;

      const { data: attData } = await db
        .from("attendance")
        .select("employee_id, date, entry_time, exit_time, is_late, employees(name, role)")
        .eq("date", today);

      const records = (attData as AttendanceRecord[]) ?? [];
      const employees = (empRes.data as Employee[]) ?? [];
      const presentIds = new Set(records.map((r) => r.employee_id));

      setLateArrivals(records.filter((r) => r.is_late));

      setEarlyExits(records.filter((r) => {
        if (!r.exit_time) return false;
        const d = new Date(r.exit_time);
        return d.getHours() * 60 + d.getMinutes() < departureMins - 30;
      }));

      setAbsent(employees.filter((e) => !presentIds.has(e.id)));
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <p className="text-slate-400">Loading…</p>;

  const allClear = lateArrivals.length === 0 && earlyExits.length === 0 && absent.length === 0;

  return (
    <div className="space-y-6">
      {allClear && (
        <div className="card py-12 text-center text-slate-400">All employees on time today — no irregularities.</div>
      )}

      {lateArrivals.length > 0 && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-amber-400">Late Arrivals Today</h2>
          <div className="divide-y divide-slate-800">
            {lateArrivals.map((r, i) => (
              <div key={i} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-white">{r.employees?.name}</p>
                  <p className="text-xs text-slate-500">{r.employees?.role}</p>
                </div>
                <span className="rounded-full bg-amber-900/40 px-3 py-1 text-xs text-amber-300">
                  In at {fmtTime(r.entry_time)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {earlyExits.length > 0 && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-orange-400">Left Early Today</h2>
          <div className="divide-y divide-slate-800">
            {earlyExits.map((r, i) => (
              <div key={i} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-white">{r.employees?.name}</p>
                  <p className="text-xs text-slate-500">{r.employees?.role}</p>
                </div>
                <span className="rounded-full bg-orange-900/40 px-3 py-1 text-xs text-orange-300">
                  Out at {fmtTime(r.exit_time)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {absent.length > 0 && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-red-400">Not Marked Today</h2>
          <div className="divide-y divide-slate-800">
            {absent.map((e) => (
              <div key={e.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-white">{e.name}</p>
                  <p className="text-xs text-slate-500">{e.role}</p>
                </div>
                <span className="rounded-full bg-red-900/40 px-3 py-1 text-xs text-red-300">Absent</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MONTHLY TAB ──────────────────────────────────────────────────────────────

function MonthlyTab() {
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [reports,  setReports]  = useState<MonthlyReport[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [msg,      setMsg]      = useState<{ text: string; ok: boolean } | null>(null);

  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { val, label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
  });

  const compute = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const db = supabase();
      const [year, month] = selectedMonth.split("-").map(Number);
      const monthStart = new Date(year, month - 1, 1);
      const monthEnd   = new Date(year, month, 0);
      const monthStartStr = monthStart.toISOString().slice(0, 10);
      const monthEndStr   = monthEnd.toISOString().slice(0, 10);

      const [empRes, attRes, ownerRes, firstAttRes] = await Promise.all([
        db.from("employees").select("id, name, role, monthly_salary, paid_leaves_pm, joining_date"),
        db.from("attendance")
          .select("employee_id, date, entry_time, exit_time, is_late")
          .gte("date", monthStartStr)
          .lte("date", monthEndStr),
        db.from("owners").select("id").single(),
        db.from("attendance").select("date").order("date", { ascending: true }).limit(1),
      ]);

      const settingsRes = ownerRes.data
        ? await db.from("settings").select("departure_time")
            .eq("owner_id", ownerRes.data.id).single()
        : null;

      const [depH, depM] = (settingsRes?.data?.departure_time ?? "17:00").split(":").map(Number);
      const departureMins = depH * 60 + depM;

      const firstEverDate: string =
        (firstAttRes.data as { date: string }[])?.[0]?.date ?? monthStartStr;
      const systemStartInMonth = firstEverDate > monthStartStr ? firstEverDate : monthStartStr;

      const today = new Date().toISOString().slice(0, 10);
      const isCurrentMonth = today.slice(0, 7) === selectedMonth;
      const effectiveEnd = isCurrentMonth && today < monthEndStr ? today : monthEndStr;

      const allRecords = (attRes.data as AttendanceRecord[]) ?? [];

      const computed: MonthlyReport[] = (empRes.data as Employee[] ?? []).map((emp) => {
        const empAtt = allRecords.filter((a) => a.employee_id === emp.id);
        const empStart = emp.joining_date && emp.joining_date > systemStartInMonth
          ? emp.joining_date : systemStartInMonth;
        const workingDays = weekdaysBetween(empStart, effectiveEnd);

        const daysPresent  = empAtt.length;
        const daysLate     = empAtt.filter((a) => a.is_late).length;
        const earlyExits   = empAtt.filter((a) => {
          if (!a.exit_time) return false;
          const d = new Date(a.exit_time);
          return d.getHours() * 60 + d.getMinutes() < departureMins - 30;
        }).length;

        const daysAbsent      = Math.max(0, workingDays - daysPresent);
        const paidLeavesAvail = emp.paid_leaves_pm ?? 0;
        const paidLeavesUsed  = Math.min(daysAbsent, paidLeavesAvail);
        const unpaidAbsences  = Math.max(0, daysAbsent - paidLeavesUsed);

        let deductions = 0, netSalary: number | null = null;
        if (emp.monthly_salary != null && workingDays > 0) {
          deductions = (emp.monthly_salary / workingDays) * unpaidAbsences;
          netSalary  = emp.monthly_salary - deductions;
        }

        const flags: string[] = [];
        if (daysLate >= 5)      flags.push(`Late ${daysLate} days`);
        if (earlyExits >= 3)    flags.push(`Left early ${earlyExits} times`);
        if (unpaidAbsences > 0) flags.push(`${unpaidAbsences} unpaid absence${unpaidAbsences > 1 ? "s" : ""}`);

        return {
          employeeId: emp.id, name: emp.name, role: emp.role,
          daysPresent, daysAbsent, daysLate, earlyExits,
          paidLeavesUsed, unpaidAbsences,
          baseSalary: emp.monthly_salary, deductions, netSalary, flags,
        };
      });

      setReports(computed);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => { compute(); }, [compute]);

  async function saveReport() {
    if (!reports.length) return;
    setSaving(true); setMsg(null);
    try {
      const db = supabase();
      const { data: owner } = await db.from("owners").select("id").single();
      if (!owner) throw new Error("Owner not found");
      const [year, month] = selectedMonth.split("-").map(Number);
      const monthDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const rows = reports.map((r) => ({
        owner_id: owner.id, employee_id: r.employeeId,
        month: monthDate, employee_name: r.name, employee_role: r.role,
        days_present: r.daysPresent, days_absent: r.daysAbsent,
        days_late: r.daysLate, early_exits: r.earlyExits,
        paid_leaves_used: r.paidLeavesUsed, unpaid_absences: r.unpaidAbsences,
        base_salary: r.baseSalary, deductions: r.deductions, net_salary: r.netSalary,
        flags: r.flags, generated_at: new Date().toISOString(),
      }));
      const { error } = await db.from("monthly_reports")
        .upsert(rows, { onConflict: "employee_id,month" });
      if (error) throw error;
      setMsg({ text: "Report saved.", ok: true });
    } catch (e: unknown) {
      setMsg({ text: e instanceof Error ? e.message : "Save failed.", ok: false });
    } finally {
      setSaving(false);
    }
  }

  const totalNet        = reports.reduce((s, r) => s + (r.netSalary ?? 0), 0);
  const totalDeductions = reports.reduce((s, r) => s + r.deductions, 0);
  const flagged         = reports.filter((r) => r.flags.length > 0);
  const lateList        = reports.filter((r) => r.daysLate > 0);
  const earlyList       = reports.filter((r) => r.earlyExits > 0);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <select className="input w-48" value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}>
          {monthOptions.map((o) => <option key={o.val} value={o.val}>{o.label}</option>)}
        </select>
        <button className="btn-primary" onClick={compute} disabled={loading}>
          {loading ? "Computing…" : "Refresh"}
        </button>
        <button className="btn-secondary" onClick={saveReport} disabled={saving || !reports.length}>
          {saving ? "Saving…" : "Save Snapshot"}
        </button>
      </div>

      {msg && (
        <p className={`rounded-lg px-4 py-3 text-sm ${msg.ok ? "bg-emerald-900/30 text-emerald-300" : "bg-red-900/30 text-red-300"}`}>
          {msg.text}
        </p>
      )}

      {/* Summary totals */}
      {reports.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-slate-800 bg-slate-800/50 p-5">
            <div className="text-2xl font-bold text-slate-200">{reports.length}</div>
            <div className="mt-1 text-xs text-slate-400">Employees</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-emerald-900/20 p-5">
            <div className="text-2xl font-bold text-emerald-400">{money(totalNet)}</div>
            <div className="mt-1 text-xs text-slate-400">Total Net Payroll</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-red-900/20 p-5">
            <div className="text-2xl font-bold text-red-400">{money(totalDeductions)}</div>
            <div className="mt-1 text-xs text-slate-400">Total Deductions</div>
          </div>
        </div>
      )}

      {/* Irregularities alert */}
      {flagged.length > 0 && (
        <div className="rounded-xl border border-amber-700/40 bg-amber-900/20 px-5 py-4">
          <p className="mb-2 font-semibold text-amber-300">Attention Required</p>
          <ul className="space-y-1 text-sm text-amber-200/80">
            {flagged.map((r) => (
              <li key={r.employeeId}>
                <span className="font-medium text-amber-300">{r.name}</span>{" — "}{r.flags.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Salary deduction table */}
      {reports.length > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="border-b border-slate-800 px-5 py-4">
            <h2 className="font-semibold text-white">Salary & Deductions</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Deduction = (base ÷ working weekdays) × unpaid absences. Paid leaves reduce absent count.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  {["Employee", "Present", "Absent", "Paid Leave", "Unpaid", "Base", "Deduction", "Net Salary"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {reports.map((r) => (
                  <tr key={r.employeeId}
                    className={`transition-colors ${r.flags.length ? "bg-amber-900/10 hover:bg-amber-900/20" : "hover:bg-slate-800/40"}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-white whitespace-nowrap">{r.name}</p>
                      <p className="text-xs text-slate-500">{r.role}</p>
                    </td>
                    <td className="px-4 py-3 text-emerald-400 font-medium">{r.daysPresent}</td>
                    <td className="px-4 py-3 text-red-400">{r.daysAbsent}</td>
                    <td className="px-4 py-3 text-slate-300">{r.paidLeavesUsed}</td>
                    <td className="px-4 py-3 text-red-300">{r.unpaidAbsences}</td>
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">{money(r.baseSalary)}</td>
                    <td className="px-4 py-3 text-red-400 whitespace-nowrap">
                      {r.deductions > 0 ? `-${money(r.deductions)}` : "—"}
                    </td>
                    <td className="px-4 py-3 font-semibold text-emerald-400 whitespace-nowrap">{money(r.netSalary)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Late arrivals this month */}
      {lateList.length > 0 && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-amber-400">Late Arrivals This Month</h2>
          <div className="flex flex-wrap gap-2">
            {lateList.map((r) => (
              <span key={r.employeeId}
                className="rounded-full bg-amber-900/30 px-3 py-1 text-sm text-amber-300">
                {r.name} — {r.daysLate} day{r.daysLate !== 1 ? "s" : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Early exits this month */}
      {earlyList.length > 0 && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-orange-400">Left Early This Month</h2>
          <div className="flex flex-wrap gap-2">
            {earlyList.map((r) => (
              <span key={r.employeeId}
                className="rounded-full bg-orange-900/30 px-3 py-1 text-sm text-orange-300">
                {r.name} — {r.earlyExits} time{r.earlyExits !== 1 ? "s" : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {reports.length === 0 && !loading && (
        <div className="card py-12 text-center text-slate-400">No employees found.</div>
      )}
    </div>
  );
}

// ─── SEARCH & CLEANUP TAB ─────────────────────────────────────────────────────

function SearchTab() {
  const twoMonthsAgo = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 2);
    return d.toISOString().slice(0, 10);
  })();
  const today = new Date().toISOString().slice(0, 10);

  const [from,     setFrom]     = useState(twoMonthsAgo);
  const [to,       setTo]       = useState(today);
  const [records,  setRecords]  = useState<AttendanceRecord[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [searched, setSearched] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteInput,   setDeleteInput]   = useState("");
  const [deleting,      setDeleting]      = useState(false);
  const [deleteMsg,     setDeleteMsg]     = useState<{ text: string; ok: boolean } | null>(null);

  async function search() {
    setLoading(true);
    setSearched(true);
    const { data } = await supabase()
      .from("attendance")
      .select("employee_id, date, entry_time, exit_time, is_late, employees(name, role)")
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: false });
    setRecords((data as AttendanceRecord[]) ?? []);
    setLoading(false);
  }

  async function deleteOldData() {
    if (deleteInput !== "DELETE") return;
    setDeleting(true);
    setDeleteMsg(null);
    try {
      // Delete all attendance records before the 'from' date
      const { error } = await supabase()
        .from("attendance")
        .delete()
        .lt("date", from);
      if (error) throw error;
      setDeleteMsg({ text: `Deleted all attendance records before ${fmtDate(from)}.`, ok: true });
      setDeleteConfirm(false);
      setDeleteInput("");
    } catch (e: unknown) {
      setDeleteMsg({ text: e instanceof Error ? e.message : "Delete failed.", ok: false });
    } finally {
      setDeleting(false);
    }
  }

  // Group records by date for display
  const byDate = records.reduce<Record<string, AttendanceRecord[]>>((acc, r) => {
    (acc[r.date] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Search controls */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-white">Search Attendance Records</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label">From</label>
            <input className="input" type="date" value={from}
              max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input className="input" type="date" value={to}
              min={from} max={today} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex items-end">
            <button className="btn-primary w-full" onClick={search} disabled={loading}>
              {loading ? "Searching…" : "Search"}
            </button>
          </div>
        </div>
        {/* Quick presets */}
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Today",        days: 0 },
            { label: "Last 7 days",  days: 7 },
            { label: "Last 30 days", days: 30 },
            { label: "Last 2 months",days: 60 },
          ].map(({ label, days }) => (
            <button key={label}
              onClick={() => {
                const end = new Date();
                const start = new Date();
                start.setDate(start.getDate() - days);
                setFrom(start.toISOString().slice(0, 10));
                setTo(end.toISOString().slice(0, 10));
              }}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:border-indigo-500 hover:text-white transition-colors">
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Search results */}
      {searched && (
        loading ? (
          <p className="text-slate-400">Searching…</p>
        ) : records.length === 0 ? (
          <div className="card py-10 text-center text-slate-400">No records found for this period.</div>
        ) : (
          <div className="space-y-4">
            {Object.entries(byDate).map(([date, rows]) => (
              <div key={date} className="card overflow-hidden p-0">
                <div className="border-b border-slate-800 bg-slate-800/40 px-5 py-3">
                  <p className="font-medium text-white">{fmtDate(date)}</p>
                  <p className="text-xs text-slate-500">{rows.length} record{rows.length !== 1 ? "s" : ""}</p>
                </div>
                <div className="divide-y divide-slate-800">
                  {rows.map((r, i) => (
                    <div key={i} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="font-medium text-white">{r.employees?.name ?? "—"}</p>
                        <p className="text-xs text-slate-500">{r.employees?.role ?? ""}</p>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="text-slate-300">{fmtTime(r.entry_time)}</span>
                        {r.exit_time && <span className="text-slate-500">→ {fmtTime(r.exit_time)}</span>}
                        {r.is_late && (
                          <span className="rounded-full bg-amber-900/40 px-2 py-0.5 text-xs text-amber-300">Late</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Delete old data */}
      <div className="card space-y-4 border-red-900/40 bg-red-950/10">
        <h2 className="font-semibold text-red-400">Delete Old Records</h2>
        <p className="text-sm text-slate-400">
          Permanently delete all attendance records <strong className="text-white">before {fmtDate(from)}</strong>.
          Monthly report snapshots you have already saved are not affected.
        </p>

        {deleteMsg && (
          <p className={`rounded-lg px-3 py-2.5 text-sm ${deleteMsg.ok ? "bg-emerald-900/30 text-emerald-300" : "bg-red-900/30 text-red-300"}`}>
            {deleteMsg.text}
          </p>
        )}

        {!deleteConfirm ? (
          <button
            onClick={() => setDeleteConfirm(true)}
            className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-900/40 transition-colors">
            Delete Records Before {fmtDate(from)}
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-red-300 font-medium">Type DELETE to confirm — this cannot be undone.</p>
            <div className="flex gap-2">
              <input className="input flex-1" placeholder="Type DELETE"
                value={deleteInput} onChange={(e) => setDeleteInput(e.target.value)} />
              <button
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                disabled={deleteInput !== "DELETE" || deleting}
                onClick={deleteOldData}>
                {deleting ? "Deleting…" : "Confirm"}
              </button>
              <button className="btn-ghost text-sm" onClick={() => { setDeleteConfirm(false); setDeleteInput(""); }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
