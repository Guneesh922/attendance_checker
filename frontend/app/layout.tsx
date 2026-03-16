import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Attendance System",
  description: "Face-recognition attendance tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen bg-[#0f1117] text-slate-100">{children}</body>
    </html>
  );
}
