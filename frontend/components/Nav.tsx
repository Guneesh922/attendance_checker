"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

const LINKS = [
  { href: "/",           label: "Dashboard",  icon: "◈" },
  { href: "/employees",  label: "Employees",  icon: "⊹" },
  { href: "/attendance", label: "Scanner",    icon: "◉" },
  { href: "/records",    label: "Records",    icon: "☰" },
  { href: "/reports",    label: "Reports",    icon: "↗" },
  { href: "/settings",   label: "Settings",   icon: "⚙" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await supabase().auth.signOut();
    router.replace("/login");
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-slate-800 bg-slate-900">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 border-b border-slate-800 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold text-sm">M</div>
        <span className="text-lg font-bold tracking-tight text-white">Mark-it</span>
      </div>

      {/* Links */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {LINKS.map(({ href, label, icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-indigo-600 text-white"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <span className="text-base leading-none">{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-slate-800 p-3">
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-red-400"
        >
          <span className="text-base leading-none">⏏</span>
          Sign Out
        </button>
      </div>
    </aside>
  );
}
