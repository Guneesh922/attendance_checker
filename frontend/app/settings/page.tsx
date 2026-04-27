"use client";
import { useState, useEffect } from "react";
import Layout from "../../components/Layout";
import { supabase } from "../../lib/supabase";

type Settings = {
  arrival_time: string;
  departure_time: string;
  report_frequency: string;
  report_email: string;
  report_enabled: boolean;
  smtp_user: string;
  smtp_pass: string;
};

const DEFAULTS: Settings = {
  arrival_time: "09:00",
  departure_time: "17:00",
  report_frequency: "weekly",
  report_email: "",
  report_enabled: false,
  smtp_user: "",
  smtp_pass: "",
};

export default function SettingsPage() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const db = supabase();
      const { data: owner } = await db.from("owners").select("id, org_name").single();
      if (!owner) return;
      setOwnerId(owner.id);
      setOrgName(owner.org_name ?? "");

      const { data: settings } = await db
        .from("settings")
        .select("*")
        .eq("owner_id", owner.id)
        .single();
      if (settings) {
        setS({
          arrival_time:    settings.arrival_time?.slice(0, 5) ?? "09:00",
          departure_time:  settings.departure_time?.slice(0, 5) ?? "17:00",
          report_frequency: settings.report_frequency ?? "weekly",
          report_email:    settings.report_email ?? "",
          report_enabled:  settings.report_enabled ?? false,
          smtp_user:       settings.smtp_user ?? "",
          smtp_pass:       settings.smtp_pass ?? "",
        });
      }
    }
    load();
  }, []);

  function update<K extends keyof Settings>(key: K, val: Settings[K]) {
    setS((prev) => ({ ...prev, [key]: val }));
  }

  async function save() {
    if (!ownerId) return;
    setSaving(true);
    setMsg(null);
    try {
      const db = supabase();

      // Update org name
      await db.from("owners").update({ org_name: orgName }).eq("id", ownerId);

      // Upsert settings
      const { error } = await db.from("settings").upsert(
        { owner_id: ownerId, ...s, updated_at: new Date().toISOString() },
        { onConflict: "owner_id" }
      );
      if (error) throw error;
      setMsg({ text: "Settings saved successfully.", ok: true });
    } catch {
      setMsg({ text: "Failed to save settings.", ok: false });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">Configure your attendance rules and email reports</p>
      </div>

      <div className="mx-auto max-w-2xl space-y-6">
        {/* Organization */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-white">Organization</h2>
          <div>
            <label className="label">Business / Organization Name</label>
            <input
              className="input"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Acme Corp"
            />
          </div>
        </div>

        {/* Work Hours */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-white">Work Hours</h2>
          <p className="text-sm text-slate-400">
            Employees arriving after the arrival time are marked as <span className="text-amber-400 font-medium">Late</span>.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Arrival Time</label>
              <input
                className="input"
                type="time"
                value={s.arrival_time}
                onChange={(e) => update("arrival_time", e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">After this = late</p>
            </div>
            <div>
              <label className="label">Departure Time</label>
              <input
                className="input"
                type="time"
                value={s.departure_time}
                onChange={(e) => update("departure_time", e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">Expected end of day</p>
            </div>
          </div>
        </div>

        {/* Email Reports */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-white">Email Reports</h2>
            <label className="flex cursor-pointer items-center gap-2">
              <span className="text-sm text-slate-400">Enable</span>
              <button
                role="switch"
                aria-checked={s.report_enabled}
                onClick={() => update("report_enabled", !s.report_enabled)}
                className={`relative h-6 w-11 rounded-full transition-colors ${s.report_enabled ? "bg-indigo-600" : "bg-slate-700"}`}
              >
                <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${s.report_enabled ? "translate-x-5" : ""}`} />
              </button>
            </label>
          </div>

          <p className="text-sm text-slate-400">
            Receive a report of late and absent employees. Uses Gmail with an App Password.
          </p>

          <div>
            <label className="label">Report Frequency</label>
            <div className="flex gap-3">
              {["weekly", "monthly"].map((freq) => (
                <button
                  key={freq}
                  onClick={() => update("report_frequency", freq)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    s.report_frequency === freq
                      ? "bg-indigo-600 text-white"
                      : "border border-slate-700 text-slate-400 hover:border-indigo-500"
                  }`}
                >
                  {freq.charAt(0).toUpperCase() + freq.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Send Reports To</label>
            <input
              className="input"
              type="email"
              placeholder="you@company.com"
              value={s.report_email}
              onChange={(e) => update("report_email", e.target.value)}
            />
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Gmail SMTP (for sending reports)
            </p>
            <div>
              <label className="label">Gmail Address</label>
              <input
                className="input"
                type="email"
                placeholder="sender@gmail.com"
                value={s.smtp_user}
                onChange={(e) => update("smtp_user", e.target.value)}
              />
            </div>
            <div>
              <label className="label">App Password</label>
              <input
                className="input"
                type="password"
                placeholder="xxxx xxxx xxxx xxxx"
                value={s.smtp_pass}
                onChange={(e) => update("smtp_pass", e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">
                Generate at Google Account → Security → App Passwords
              </p>
            </div>
          </div>
        </div>

        {/* Save */}
        {msg && (
          <p className={`rounded-lg px-4 py-3 text-sm ${msg.ok ? "bg-emerald-900/30 text-emerald-300" : "bg-red-900/30 text-red-300"}`}>
            {msg.text}
          </p>
        )}
        <button className="btn-primary w-full" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save Settings"}
        </button>
      </div>
    </Layout>
  );
}
