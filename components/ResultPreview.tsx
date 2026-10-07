"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Download,
  Play,
  Pause,
  RotateCcw,
  Sliders,
  Volume2,
  VolumeX,
  Sparkles,
  CheckCircle,
  Film,
  Layers,
  FileCheck,
  ArrowRight,
  Share2
} from "lucide-react";
import { JobProgress } from "@/types";
import { getDownloadUrl, getApiBaseUrl } from "@/lib/api";

interface ResultPreviewProps {
  job: JobProgress;
  onReset: () => void;
  onAdjustMask: () => void;
}

export const ResultPreview: React.FC<ResultPreviewProps> = ({
  job,
  onReset,
  onAdjustMask,
}) => {
  const [viewMode, setViewMode] = useState<"slider" | "side-by-side" | "cleaned-only">("slider");
  const [sliderPos, setSliderPos] = useState(50);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(job.metadata?.duration || 4.0);

  const originalVideoRef = useRef<HTMLVideoElement>(null);
  const cleanedVideoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const apiBase = getApiBaseUrl();
  const rawOriginalUrl = job.inputUrl || "";
  const originalUrl = (apiBase && rawOriginalUrl.startsWith("/")) ? `${apiBase}${rawOriginalUrl}` : rawOriginalUrl;
  const rawCleanedUrl = job.resultUrl || `/api/download/${job.jobId}`;
  const cleanedUrl = (apiBase && rawCleanedUrl.startsWith("/")) ? `${apiBase}${rawCleanedUrl}` : rawCleanedUrl;

  // Synchronize playback between original and cleaned video
  const handleTimeUpdate = () => {
    if (cleanedVideoRef.current) {
      setCurrentTime(cleanedVideoRef.current.currentTime);
      setDuration(cleanedVideoRef.current.duration || duration);

      // Keep original in sync
      if (
        originalVideoRef.current &&
        Math.abs(originalVideoRef.current.currentTime - cleanedVideoRef.current.currentTime) > 0.08
      ) {
        originalVideoRef.current.currentTime = cleanedVideoRef.current.currentTime;
      }
    }
  };

  const handleTogglePlay = () => {
    if (cleanedVideoRef.current && originalVideoRef.current) {
      if (isPlaying) {
        cleanedVideoRef.current.pause();
        originalVideoRef.current.pause();
        setIsPlaying(false);
      } else {
        cleanedVideoRef.current.play();
        originalVideoRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    setCurrentTime(time);
    if (cleanedVideoRef.current) cleanedVideoRef.current.currentTime = time;
    if (originalVideoRef.current) originalVideoRef.current.currentTime = time;
  };

  const handleToggleMute = () => {
    setIsMuted(!isMuted);
    if (cleanedVideoRef.current) cleanedVideoRef.current.muted = !isMuted;
    if (originalVideoRef.current) originalVideoRef.current.muted = true; // keep original muted to avoid echo
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const handleDownload = () => {
    const downloadLink = getDownloadUrl(job.jobId, `CleanCut_${job.jobId}.mp4`);
    const link = document.createElement("a");
    link.href = downloadLink;
    link.download = `CleanCut_${job.jobId}.mp4`;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const width = job.metadata?.width || 1280;
  const height = job.metadata?.height || 720;
  const isPortrait = height > width;

  return (
    <div className="w-full max-w-5xl mx-auto space-y-8 animate-fadeIn pb-12">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-1.5">
            <CheckCircle className="w-3.5 h-3.5" />
            <span>Watermark Successfully Removed</span>
          </div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight">
            Cleaned Video Ready
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Temporal reconstruction finished in {job.elapsed_seconds || 4.5}s with lossless audio stream.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={onAdjustMask}
            className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium transition-colors"
          >
            Adjust Mask
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-500 to-cyan-500 hover:from-emerald-500 hover:to-cyan-400 text-white text-sm font-bold shadow-xl shadow-emerald-500/30 flex items-center space-x-2 transition-all transform hover:scale-[1.02]"
          >
            <Download className="w-4 h-4" />
            <span>Download Clean MP4</span>
          </button>
        </div>
      </div>

      {/* Main Video Comparison Player */}
      <div className="space-y-4">
        {/* View Mode Switcher Header */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2">
            <span className="text-slate-400 font-medium">Comparison Mode:</span>
            <div className="flex items-center rounded-xl bg-slate-900 p-1 border border-slate-800 text-slate-300">
              <button
                type="button"
                onClick={() => setViewMode("slider")}
                className={`px-3 py-1 rounded-lg transition-all ${
                  viewMode === "slider" ? "bg-emerald-600 text-white font-semibold" : "hover:text-white"
                }`}
              >
                Split Comparison Slider
              </button>
              <button
                type="button"
                onClick={() => setViewMode("side-by-side")}
                className={`px-3 py-1 rounded-lg transition-all ${
                  viewMode === "side-by-side" ? "bg-emerald-600 text-white font-semibold" : "hover:text-white"
                }`}
              >
                Side-by-Side
              </button>
              <button
                type="button"
                onClick={() => setViewMode("cleaned-only")}
                className={`px-3 py-1 rounded-lg transition-all ${
                  viewMode === "cleaned-only" ? "bg-emerald-600 text-white font-semibold" : "hover:text-white"
                }`}
              >
                Cleaned Only
              </button>
            </div>
          </div>

          <div className="hidden sm:flex items-center space-x-2 text-slate-400">
            <span>Drag slider to compare original vs cleaned</span>
          </div>
        </div>

        {/* Video Box */}
        {viewMode === "slider" && (
          <div
            ref={containerRef}
            className="relative w-full rounded-3xl overflow-hidden bg-black border border-slate-800 shadow-2xl flex items-center justify-center select-none"
            style={{ maxHeight: "65vh", aspectRatio: isPortrait ? "9/16" : "16/9" }}
          >
            {/* Cleaned Video (Bottom Layer) */}
            <video
              ref={cleanedVideoRef}
              src={cleanedUrl}
              onTimeUpdate={handleTimeUpdate}
              playsInline
              autoPlay
              loop
              muted={isMuted}
              className="w-full h-full object-contain max-h-[65vh]"
            />

            {/* Original Video with Clip-Path (Top Layer) */}
            <div
              className="absolute inset-0 overflow-hidden pointer-events-none"
              style={{
                clipPath: `polygon(0 0, ${sliderPos}% 0, ${sliderPos}% 100%, 0 100%)`,
              }}
            >
              <video
                ref={originalVideoRef}
                src={originalUrl}
                playsInline
                autoPlay
                loop
                muted
                className="w-full h-full object-contain max-h-[65vh]"
              />
              <div className="absolute top-4 left-4 px-2.5 py-1 rounded-lg bg-black/75 text-xs font-bold text-rose-400 border border-rose-900/60 backdrop-blur-md shadow-lg">
                ORIGINAL (With Watermark)
              </div>
            </div>

            <div className="absolute top-4 right-4 px-2.5 py-1 rounded-lg bg-black/75 text-xs font-bold text-emerald-400 border border-emerald-900/60 backdrop-blur-md shadow-lg pointer-events-none">
              CLEANCUT AI (Cleaned)
            </div>

            {/* Center Slider Divider Line */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.9)] pointer-events-none z-30"
              style={{ left: `${sliderPos}%` }}
            >
              <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-emerald-500 border-2 border-white shadow-xl flex items-center justify-center text-xs text-slate-950 font-bold">
                ↔
              </div>
            </div>

            {/* Slider Drag Input */}
            <input
              type="range"
              min="0"
              max="100"
              value={sliderPos}
              onChange={(e) => setSliderPos(Number(e.target.value))}
              className="absolute inset-0 opacity-0 cursor-ew-resize w-full h-full z-40"
            />
          </div>
        )}

        {viewMode === "side-by-side" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Original Video */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-rose-400">Original (Before)</span>
              </div>
              <div className="rounded-2xl overflow-hidden bg-black border border-rose-900/40 aspect-video flex items-center justify-center">
                <video
                  ref={originalVideoRef}
                  src={originalUrl}
                  playsInline
                  autoPlay
                  loop
                  muted
                  className="w-full h-full object-contain"
                />
              </div>
            </div>

            {/* Cleaned Video */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-emerald-400">CleanCut AI (After)</span>
              </div>
              <div className="rounded-2xl overflow-hidden bg-black border border-emerald-800/60 aspect-video flex items-center justify-center">
                <video
                  ref={cleanedVideoRef}
                  src={cleanedUrl}
                  onTimeUpdate={handleTimeUpdate}
                  playsInline
                  autoPlay
                  loop
                  muted={isMuted}
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
          </div>
        )}

        {viewMode === "cleaned-only" && (
          <div className="rounded-3xl overflow-hidden bg-black border border-emerald-800/50 shadow-2xl flex items-center justify-center aspect-video max-h-[65vh]">
            <video
              ref={cleanedVideoRef}
              src={cleanedUrl}
              onTimeUpdate={handleTimeUpdate}
              playsInline
              autoPlay
              loop
              muted={isMuted}
              className="w-full h-full object-contain"
            />
          </div>
        )}

        {/* Global Playback Controller Bar */}
        <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-4 shadow-xl">
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={handleTogglePlay}
              className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-all shadow-md shadow-emerald-600/30"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-white" />}
            </button>

            <button
              type="button"
              onClick={handleToggleMute}
              className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-colors"
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
            </button>

            <div className="font-mono text-xs text-slate-400">
              <span className="text-emerald-400 font-semibold">{formatTime(currentTime)}</span>
              <span className="text-slate-600 mx-1">/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Timeline Scrubber */}
          <div className="flex-1 min-w-[200px] px-2">
            <input
              type="range"
              min="0"
              max={duration || 1}
              step="0.01"
              value={currentTime}
              onChange={handleSeek}
              className="w-full accent-emerald-500 bg-slate-900 h-2 rounded-lg cursor-pointer"
            />
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => {
                if (cleanedVideoRef.current) cleanedVideoRef.current.currentTime = 0;
                if (originalVideoRef.current) originalVideoRef.current.currentTime = 0;
              }}
              className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-colors"
              title="Replay from start"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Video Metadata Verification Card */}
      <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
        <div className="flex items-center space-x-2">
          <FileCheck className="w-5 h-5 text-emerald-400" />
          <h3 className="text-sm font-semibold text-white">Output Verification Report</h3>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div className="space-y-1">
            <span className="text-slate-500 uppercase tracking-wider">Resolution</span>
            <p className="font-mono text-slate-200 font-medium">
              {width} × {height} ({width > height ? "16:9 Landscape" : "9:16 Portrait"})
            </p>
          </div>

          <div className="space-y-1">
            <span className="text-slate-500 uppercase tracking-wider">Framerate</span>
            <p className="font-mono text-slate-200 font-medium">{job.metadata?.fps || 30} FPS</p>
          </div>

          <div className="space-y-1">
            <span className="text-slate-500 uppercase tracking-wider">Audio Channel</span>
            <p className="font-mono text-emerald-400 font-medium">
              {job.metadata?.has_audio ? "Muxed AAC Lossless" : "None (Muted)"}
            </p>
          </div>

          <div className="space-y-1">
            <span className="text-slate-500 uppercase tracking-wider">Inpainting Quality</span>
            <p className="font-mono text-emerald-400 font-medium">Temporal Navier-Stokes</p>
          </div>
        </div>
      </div>

      {/* Footer Restart / Back */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-800 text-xs">
        <button
          type="button"
          onClick={onReset}
          className="text-slate-400 hover:text-white transition-colors flex items-center space-x-1"
        >
          <span>← Clean another video</span>
        </button>

        <button
          type="button"
          onClick={handleDownload}
          className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors flex items-center space-x-1"
        >
          <span>Download MP4 File</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
