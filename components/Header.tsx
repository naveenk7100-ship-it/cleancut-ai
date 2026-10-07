"use client";

import React, { useEffect, useState } from "react";
import { Scissors, Cpu, Zap, ShieldCheck, Activity, CheckCircle2, AlertCircle } from "lucide-react";
import { HardwareInfo } from "@/types";
import { checkBackendHealth, getApiBaseUrl } from "@/lib/api";

interface HeaderProps {
  hardware?: HardwareInfo | null;
}

export const Header: React.FC<HeaderProps> = ({ hardware: initialHardware }) => {
  const [hardware, setHardware] = useState<HardwareInfo | null>(initialHardware || null);
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking");
  const apiBase = getApiBaseUrl();

  useEffect(() => {
    let mounted = true;
    checkBackendHealth().then((res) => {
      if (!mounted) return;
      if (res.ok && res.data) {
        setBackendStatus("online");
        if (res.data.hardware) {
          setHardware(res.data.hardware);
        }
      } else {
        setBackendStatus("offline");
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <header className="w-full border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo and Slogan */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-cyan-400 p-[2px] shadow-lg shadow-emerald-500/20">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Scissors className="w-5 h-5 text-emerald-400 transform -rotate-45" />
            </div>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xl font-bold tracking-tight text-white font-sans">
                CleanCut<span className="text-emerald-400">.AI</span>
              </span>
              <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full uppercase tracking-wider">
                v1.0 Pro
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              Clean your videos, not your quality.
            </p>
          </div>
        </div>

        {/* Right Info: Hardware & Zero Cloud Badge */}
        <div className="flex items-center space-x-3">
          {/* Backend Status Badge */}
          <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300">
            {backendStatus === "online" ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-300 font-medium">Engine Active</span>
              </>
            ) : backendStatus === "checking" ? (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-amber-300">Connecting...</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-rose-400" />
                <span className="text-rose-300">Offline / Standby</span>
              </>
            )}
          </div>

          {/* Hardware Acceleration Indicator */}
          <div className="hidden md:flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300">
            {hardware?.cuda_available ? (
              <>
                <Zap className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span className="text-amber-300 font-medium">GPU Accelerated</span>
                <span className="text-slate-500">|</span>
                <span className="text-slate-400">{hardware.device_name}</span>
              </>
            ) : (
              <>
                <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-300 font-medium">Multi-Core Engine</span>
                <span className="text-slate-500">|</span>
                <span className="text-slate-400">{hardware?.threads || 8} Threads</span>
              </>
            )}
          </div>

          {/* Privacy badge */}
          <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-xs text-emerald-300">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="font-medium hidden sm:inline">100% Private</span>
          </div>
        </div>
      </div>
    </header>
  );
};
