"use client";

import React, { useState, useRef, DragEvent } from "react";
import { Upload, Film, PlayCircle, ShieldCheck, Sparkles, Video, Volume2, Layers, AlertCircle, Loader2 } from "lucide-react";
import { VideoMetadata } from "@/types";
import { uploadVideoFile, loadSamplePreset } from "@/lib/api";

interface VideoUploaderProps {
  onVideoLoaded: (data: {
    jobId: string;
    videoUrl: string;
    fileName: string;
    metadata: VideoMetadata;
    defaultMask?: any;
  }) => void;
}

export const VideoUploader: React.FC<VideoUploaderProps> = ({ onVideoLoaded }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  };

  const handleFileSelected = async (file: File) => {
    setErrorMessage(null);
    setIsLoading(true);
    setLoadingText(`Uploading & analyzing ${file.name}...`);

    try {
      const data = await uploadVideoFile(file);
      onVideoLoaded({
        jobId: data.jobId,
        videoUrl: data.videoUrl,
        fileName: data.fileName,
        metadata: data.metadata,
      });
    } catch (err: any) {
      setErrorMessage(err.message || "Upload failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadSample = async (sampleId: "sample_landscape" | "sample_portrait") => {
    setErrorMessage(null);
    setIsLoading(true);
    setLoadingText(
      sampleId === "sample_landscape"
        ? "Loading 16:9 Landscape sample with fixed watermark..."
        : "Loading 9:16 Portrait sample with moving watermark..."
    );

    try {
      const data = await loadSamplePreset(sampleId);
      onVideoLoaded({
        jobId: data.jobId,
        videoUrl: data.videoUrl,
        fileName: data.fileName,
        metadata: data.metadata,
        defaultMask: data.defaultMask,
      });
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to load sample");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-8 animate-fadeIn">
      {/* Hero Title and Subtitle */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold tracking-wide uppercase">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Next-Gen Video Watermark Inpainting</span>
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight">
          Clean your videos, <br className="hidden sm:inline" />
          <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
            not your quality.
          </span>
        </h1>
        <p className="text-slate-400 max-w-2xl mx-auto text-sm sm:text-base leading-relaxed">
          Remove fixed or moving watermarks seamlessly using temporal frame reconstruction and Navier-Stokes PDE inpainting.
          Zero blurring, zero degradation, 100% audio preserved.
        </p>
      </div>

      {/* Error Alert with Retry */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-800/80 text-rose-300 text-sm flex items-start justify-between space-x-3 shadow-lg shadow-rose-950/30">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-rose-200">Error processing video</p>
              <p className="mt-0.5">{errorMessage}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="px-3 py-1 bg-rose-900/60 hover:bg-rose-800 text-rose-200 text-xs rounded-lg transition-colors flex-shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Drag & Drop Upload Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isLoading && fileInputRef.current?.click()}
        className={`relative group rounded-3xl border-2 border-dashed p-8 sm:p-12 text-center transition-all duration-300 cursor-pointer overflow-hidden ${
          isDragging
            ? "border-emerald-400 bg-emerald-950/20 scale-[1.01] shadow-2xl shadow-emerald-500/20"
            : "border-slate-800 hover:border-emerald-500/50 bg-slate-900/40 hover:bg-slate-900/70"
        }`}
      >
        {/* Glow backdrop */}
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileInputChange}
          accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv"
          className="hidden"
        />

        {isLoading ? (
          <div className="py-8 flex flex-col items-center justify-center space-y-4">
            <Loader2 className="w-12 h-12 text-emerald-400 animate-spin" />
            <div className="space-y-1">
              <p className="text-base font-medium text-white">{loadingText}</p>
              <p className="text-xs text-slate-400">Analyzing video streams, FPS, and audio channels...</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-slate-800 to-slate-900 border border-slate-700/80 flex items-center justify-center group-hover:border-emerald-500/50 group-hover:scale-110 transition-all duration-300 shadow-xl">
              <Upload className="w-8 h-8 text-emerald-400 group-hover:text-emerald-300 transition-colors" />
            </div>

            <div className="space-y-1">
              <p className="text-lg font-semibold text-white">
                Drag & drop your video here, or <span className="text-emerald-400 underline underline-offset-4">browse</span>
              </p>
              <p className="text-xs sm:text-sm text-slate-400">
                Supports MP4, MOV, WebM, MKV up to 500MB (Portrait 9:16, Landscape 16:9, Square 1:1)
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              <span className="px-2.5 py-1 rounded-md bg-slate-800/80 text-[11px] font-medium text-slate-300 border border-slate-700">
                MP4 / H.264
              </span>
              <span className="px-2.5 py-1 rounded-md bg-slate-800/80 text-[11px] font-medium text-slate-300 border border-slate-700">
                MOV / ProRes
              </span>
              <span className="px-2.5 py-1 rounded-md bg-slate-800/80 text-[11px] font-medium text-slate-300 border border-slate-700">
                WebM / VP9
              </span>
              <span className="px-2.5 py-1 rounded-md bg-emerald-950/40 text-[11px] font-medium text-emerald-400 border border-emerald-800/50">
                Lossless Audio Sync
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Instant Demo Samples Section */}
      <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <PlayCircle className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">Don&apos;t have a video handy? Try pre-built test samples:</h3>
          </div>
          <span className="text-xs text-slate-400">1-click instant test</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Sample 1: Landscape */}
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleLoadSample("sample_landscape")}
            className="group text-left p-4 rounded-xl bg-slate-950/60 hover:bg-slate-950 border border-slate-800 hover:border-emerald-500/50 transition-all duration-200 flex items-start space-x-3"
          >
            <div className="w-10 h-10 rounded-lg bg-emerald-950/50 border border-emerald-800/50 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
              <Film className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-slate-200 group-hover:text-emerald-400 transition-colors">
                  Landscape 16:9 Sample
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">Fixed Mask</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                1280x720 video with dynamic geometry, camera motion, watermark badge & audio.
              </p>
            </div>
          </button>

          {/* Sample 2: Portrait */}
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleLoadSample("sample_portrait")}
            className="group text-left p-4 rounded-xl bg-slate-950/60 hover:bg-slate-950 border border-slate-800 hover:border-teal-500/50 transition-all duration-200 flex items-start space-x-3"
          >
            <div className="w-10 h-10 rounded-lg bg-teal-950/50 border border-teal-800/50 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
              <Video className="w-5 h-5 text-teal-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-slate-200 group-hover:text-teal-400 transition-colors">
                  Portrait 9:16 Sample
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-950 text-teal-400 border border-teal-800/40">
                  Moving Logo
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                720x1280 vertical video with moving watermark tracking across timestamps.
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* Feature Guarantee Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
        <div className="p-4 rounded-xl bg-slate-900/30 border border-slate-800/60 space-y-2">
          <div className="flex items-center space-x-2 text-emerald-400">
            <Layers className="w-4 h-4" />
            <h4 className="text-xs font-semibold text-slate-200">Temporal Pixel Reconstruction</h4>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Reconstructs covered pixels from neighboring frames using motion flow. Never blurs or pixelates.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/30 border border-slate-800/60 space-y-2">
          <div className="flex items-center space-x-2 text-teal-400">
            <Volume2 className="w-4 h-4" />
            <h4 className="text-xs font-semibold text-slate-200">Lossless Audio & Sync</h4>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Maintains original audio track, sample rate, bitrate, and lip-sync timings with zero quality loss.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/30 border border-slate-800/60 space-y-2">
          <div className="flex items-center space-x-2 text-cyan-400">
            <ShieldCheck className="w-4 h-4" />
            <h4 className="text-xs font-semibold text-slate-200">100% On-Premise & Free</h4>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Runs locally on multi-core CPU / GPU. No third-party cloud APIs, no subscription fees.
          </p>
        </div>
      </div>
    </div>
  );
};
