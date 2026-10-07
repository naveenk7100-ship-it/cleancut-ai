import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CleanCut AI — Video Watermark Removal",
  description: "Clean your videos, not your quality. High-fidelity temporal video inpainting without blurring or degradation.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased min-h-screen flex flex-col bg-dark-bg text-slate-100 selection:bg-emerald-500 selection:text-slate-950">
        {children}
      </body>
    </html>
  );
}
