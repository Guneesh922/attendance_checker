"use client";
import Nav from "./Nav";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-950">
      <Nav />
      <main className="ml-60 flex-1 p-6 lg:p-8">{children}</main>
    </div>
  );
}
