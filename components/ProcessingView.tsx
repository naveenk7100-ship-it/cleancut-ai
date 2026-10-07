"use client";

import React, { useEffect, useState, useRef } from "react";
import { Loader2, Zap, Clock, CheckCircle2, AlertCircle, Film, Volume2, Cpu } from "lucide-react";
import { JobProgress } from "@/types";

import { getJobStreamUrl } from "@/lib/api";

interface ProcessingViewProps {
  jobId: string;
  onCompleted: (job: JobProgress) => void;
  onFailed: (error: string) => void;
}

export const ProcessingView: React.FC<ProcessingViewProps> = ({
  jobId,
  onCompleted,
  onFailed,
}) => {
  const [job, setJob] = useState<JobProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let isMounted = true;
    let pollInterval: NodeJS.Timeout | null = null;
    const streamUrl = getJobStreamUrl(jobId);

    // Connect via Server-Sent Events (SSE)
    try {
      const es = new EventSource(streamUrl);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const data: JobProgress = JSON.parse(event.data);
          setJob(data);

          if (data.status === "completed") {
            es.close();
            onCompleted(data);
          } else if (data.status === "failed") {
            es.close();
            setError(data.error || "Inpainting job failed");
            onFailed(data.error || "Inpainting job failed");
          }
        } catch (e) {
          // ignore parse error
        }
      };

      es.onerror = () => {
        // If SSE fails or drops, fallback to polling
        if (es.readyState === EventSource.CLOSED) {
          startPolling();
        }
      };
    } catch (e) {
      startPolling();
    }

    // Polling fallback
    function startPolling() {
      if (pollInterval) return;
      pollInterval = setInterval(async () => {
        if (!isMounted) return;
        try {
          const res = await fetch(streamUrl);
          if (!res.ok) return;
          const data: JobProgress = await res.json();
          setJob(data);

          if (data.status === "completed") {
            if (pollInterval) clearInterval(pollInterval);
            onCompleted(data);
          } else if (data.status === "failed") {
            if (pollInterval) clearInterval(pollInterval);
            setError(data.error || "Inpainting job failed");
            onFailed(data.error || "Inpainting job failed");
          }
        } catch (err) {}
      }, 800);
    }

    return () => {
      isMounted = false;
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [jobId, onCompleted, onFailed]);

  const progress = job?.progress || 0;
  const stage = job?.stage || "Initializing frame inpainting pipeline...";
  const frame = job?.frame || 0;
  const totalFrames = job?.total_frames || 1;
  const fps = job?.fps || 0;
  const eta = job?.eta_seconds !== undefined ? `${job.eta_seconds.toFixed(1)}s` : "Calculating...";
  const elapsed = job?.elapsed_seconds !== undefined ? `${job.elapsed_seconds.toFixed(1)}s` : "0.0s";

  return (
    <div className="w-full max-w-3xl mx-auto py-8 space-y-8 animate-fadeIn">
      {/* Top Title */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>Real-time Inpainting Active</span>
        </div>
        <h2 className="text-3xl font-bold text-white tracking-tight">
          Reconstructing Video Frames
        </h2>
        <p className="text-sm text-slate-400 max-w-lg mx-auto">
          Searching neighbor frames for background pixels, solving Navier-Stokes fluid equations, and preserving audio.
        </p>
      </div>

      {/* Main Progress Card */}
      <div className="relative rounded-3xl bg-slate-900/90 border border-slate-800 p-8 shadow-2xl overflow-hidden space-y-6">
        {/* Animated Glow Top Border */}
        <div
          className="absolute top-0 left-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />

        {/* Big Progress Display */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="space-y-1 text-center sm:text-left">
            <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
              Current Stage
            </span>
            <h3 className="text-xl font-bold text-white font-mono">{stage}</h3>
            <p className="text-xs text-slate-400">
              Frame <span className="text-slate-200 font-mono font-medium">{frame}</span> of {totalFrames}
            </p>
          </div>

          <div className="flex items-baseline space-x-1">
            <span className="text-5xl sm:text-6xl font-extrabold text-white font-mono tracking-tight">
              {Math.round(progress)}
            </span>
            <span className="text-2xl font-bold text-emerald-400 font-mono">%</span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-3.5 bg-slate-950 rounded-full overflow-hidden p-0.5 border border-slate-800">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 rounded-full transition-all duration-300 shadow-[0_0_12px_rgba(52,211,153,0.5)]"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          {/* Speed */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1">
            <div className="flex items-center space-x-1.5 text-slate-400 text-xs">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Speed</span>
            </div>
            <p className="text-base font-bold text-white font-mono">
              {fps > 0 ? `${fps.toFixed(1)} FPS` : "--"}
            </p>
          </div>

          {/* Elapsed */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1">
            <div className="flex items-center space-x-1.5 text-slate-400 text-xs">
              <Clock className="w-3.5 h-3.5 text-teal-400" />
              <span>Elapsed</span>
            </div>
            <p className="text-base font-bold text-white font-mono">{elapsed}</p>
          </div>

          {/* ETA */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1">
            <div className="flex items-center space-x-1.5 text-slate-400 text-xs">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              <span>Est. Remaining</span>
            </div>
            <p className="text-base font-bold text-white font-mono">{eta}</p>
          </div>

          {/* Audio */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1">
            <div className="flex items-center space-x-1.5 text-slate-400 text-xs">
              <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
              <span>Audio</span>
            </div>
            <p className="text-base font-bold text-emerald-400 font-mono text-xs">
              {job?.metadata?.has_audio ? "Muxed Lossless" : "Video Only"}
            </p>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-sm flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-rose-200">Processing error</p>
              <p className="mt-0.5">{error}</p>
            </div>
          </div>
        )}
      </div>

      {/* Information reassurance notes */}
      <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-slate-400">
        <span className="flex items-center space-x-1.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>Original frame resolution retained</span>
        </span>
        <span className="flex items-center space-x-1.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>Exact FPS & timestamps synced</span>
        </span>
        <span className="flex items-center space-x-1.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>Lossless unmasked regions</span>
        </span>
      </div>
    </div>
  );
};
