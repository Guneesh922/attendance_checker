"use client";
import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useRouter } from "next/navigation";

function NavLink({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-[#2a3147] hover:text-white transition-colors">{label}</Link>;
}

export default function Nav() {
  const router = useRouter();
  async function logout() {
    await signOut(auth);
    document.cookie = "session=; path=/; max-age=0";
    router.replace("/login");
  }
  return (
    <nav className="flex items-center justify-between border-b border-[#2a3147] bg-[#1a1f2e] px-6 py-3">
      <span className="font-bold text-white">🏢 Attendance</span>
      <div className="flex items-center gap-1">
        <NavLink href="/" label="Dashboard" />
        <NavLink href="/employees" label="Employees" />
        <NavLink href="/attendance" label="Attendance" />
        <NavLink href="/reports" label="Reports" />
        <NavLink href="/settings" label="Settings" />
        <button id="logout-btn" onClick={logout} className="ml-3 btn-ghost text-xs">Sign out</button>
      </div>
    </nav>
  );
}
