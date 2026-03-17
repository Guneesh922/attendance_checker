import axios from "axios";
import { auth } from "./firebase";

// Support both variable names in case of legacy instructions
const rawBase = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "";
// Strip any trailing slash so `${BASE}/employees/` is always clean
export const BASE = rawBase.replace(/\/+$/, "");
console.log("Resolved API BASE URL:", BASE || "[EMPTY - NEXT_PUBLIC_API_URL IS MISSING]");

async function headers() {
  const token = await auth.currentUser?.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

// ── Employees ──────────────────────────────────────────────────────────────
export async function listEmployees() {
  return axios.get(`${BASE}/employees/`, { headers: await headers() });
}

export async function registerEmployee(name: string, role: string, blob: Blob) {
  const fd = new FormData();
  fd.append("name", name);
  fd.append("role", role);
  fd.append("file", blob, "face.jpg");
  const hdrs = await headers();
  return axios.post(`${BASE}/employees/`, fd, { headers: hdrs });
}

export async function updateEmployee(
  oldName: string, newName: string, newRole: string, blob?: Blob
) {
  const fd = new FormData();
  if (blob) fd.append("file", blob, "face.jpg");
  return axios.put(
    `${BASE}/employees/${encodeURIComponent(oldName)}?new_name=${encodeURIComponent(newName)}&new_role=${encodeURIComponent(newRole)}`,
    fd, { headers: await headers() }
  );
}

export async function deleteEmployee(name: string) {
  return axios.delete(`${BASE}/employees/${encodeURIComponent(name)}`, { headers: await headers() });
}

export async function addFaceImage(name: string, blob: Blob) {
  const fd = new FormData();
  fd.append("file", blob, "face.jpg");
  return axios.post(`${BASE}/employees/${encodeURIComponent(name)}/images`, fd, { headers: await headers() });
}

// ── Recognition ────────────────────────────────────────────────────────────
export async function recognize(imageB64: string) {
  return axios.post(`${BASE}/recognize`, { image_b64: imageB64 }, { headers: await headers() });
}

// ── Attendance ─────────────────────────────────────────────────────────────
export async function markEntry(name: string) {
  return axios.post(`${BASE}/attendance/entry`, { name }, { headers: await headers() });
}
export async function markExit(name: string) {
  return axios.post(`${BASE}/attendance/exit`, { name }, { headers: await headers() });
}
export async function getToday() {
  return axios.get(`${BASE}/attendance/today`, { headers: await headers() });
}
export async function getByDate(date: string) {
  return axios.get(`${BASE}/attendance/date/${date}`, { headers: await headers() });
}
export async function getByMonth(year: number, month: number) {
  return axios.get(`${BASE}/attendance/month/${year}/${month}`, { headers: await headers() });
}
export async function getIrregulars(year: number, month: number) {
  return axios.get(`${BASE}/attendance/irregulars/${year}/${month}`, { headers: await headers() });
}
export function csvUrl(params: string) {
  return `${BASE}/attendance/export/csv?${params}`;
}

// ── Settings & Email ────────────────────────────────────────────────────────
export async function getSettings() {
  return axios.get(`${BASE}/settings/`, { headers: await headers() });
}
export async function saveSettings(data: Record<string, string>) {
  return axios.put(`${BASE}/settings/`, { data }, { headers: await headers() });
}
export async function sendReport() {
  return axios.post(`${BASE}/email/send`, {}, { headers: await headers() });
}
export async function saveEmailConfig(payload: object) {
  return axios.put(`${BASE}/email/config`, payload, { headers: await headers() });
}
