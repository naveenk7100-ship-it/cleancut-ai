"use client";

import React, { useRef } from "react";
import { Play, Pause, ChevronLeft, ChevronRight, SkipBack, SkipForward, Plus, Trash2, Key } from "lucide-react";
import { Keyframe } from "@/types";

interface VideoTimelineScrubberProps {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  keyframes: Keyframe[];
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  onStepFrame: (direction: number) => void;
  onAddKeyframe?: () => void;
  onRemoveCurrentKeyframe?: () => void;
  fps?: number;
  isMovingWatermarkMode?: boolean;
}

export const VideoTimelineScrubber: React.FC<VideoTimelineScrubberProps> = ({
  currentTime,
  duration,
  isPlaying,
  keyframes,
  onSeek,
  onTogglePlay,
  onStepFrame,
  onAddKeyframe,
  onRemoveCurrentKeyframe,
  fps = 30,
  isMovingWatermarkMode = false,
}) => {
  const timelineRef = useRef<HTMLDivElement>(null);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms
      .toString()
      .padStart(2, "0")}`;
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || duration <= 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(pos * duration);
  };

  const currentFrame = Math.round(currentTime * fps);
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Check if current timestamp is close to any existing keyframe
  const activeKeyframe = keyframes.find((kf) => Math.abs(kf.time - currentTime) < 0.1);

  return (
    <div className="w-full bg-slate-950 border border-slate-800/90 rounded-2xl p-4 space-y-3 shadow-xl">
      {/* Timeline Bar with Keyframe Markers */}
      <div className="space-y-1.5">
        <div
          ref={timelineRef}
          onClick={handleTimelineClick}
          className="relative w-full h-8 bg-slate-900 border border-slate-800 rounded-xl cursor-pointer select-none overflow-hidden group"
        >
          {/* Progress Filled Track */}
          <div
            className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-emerald-600/30 to-teal-500/40 pointer-events-none"
            style={{ width: `${progressPercent}%` }}
          />

          {/* Time ticks background pattern */}
          <div className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none opacity-20">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="h-2 w-[1px] bg-slate-400" />
            ))}
          </div>

          {/* Keyframe Diamond Markers */}
          {keyframes.map((kf, idx) => {
            const kfPos = duration > 0 ? (kf.time / duration) * 100 : 0;
            const isSelected = activeKeyframe && Math.abs(activeKeyframe.time - kf.time) < 0.05;
            return (
              <div
                key={idx}
                title={`Keyframe #${idx + 1} at ${kf.time.toFixed(2)}s`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSeek(kf.time);
                }}
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 transform rotate-45 transition-all z-20 cursor-pointer ${
                  isSelected
                    ? "bg-amber-400 border-2 border-white scale-125 shadow-lg shadow-amber-500/50"
                    : "bg-teal-400 border border-slate-900 hover:scale-110"
                }`}
                style={{ left: `${kfPos}%` }}
              />
            );
          })}

          {/* Scrubber Playhead */}
          <div
            className="absolute top-0 bottom-0 w-1 bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)] pointer-events-none z-30"
            style={{ left: `${progressPercent}%` }}
          >
            <div className="absolute -top-1.5 -translate-x-1/2 w-3.5 h-3.5 bg-emerald-400 border border-white rounded-full shadow-md" />
          </div>
        </div>
      </div>

      {/* Control Buttons & Time Display */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Left: Playback Controls */}
        <div className="flex items-center space-x-2">
          {/* Step Frame Back */}
          <button
            type="button"
            onClick={() => onStepFrame(-1)}
            title="Step Back 1 Frame (Left Arrow)"
            className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Play / Pause */}
          <button
            type="button"
            onClick={onTogglePlay}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center space-x-1.5 shadow-lg shadow-emerald-500/20 transition-all"
          >
            {isPlaying ? (
              <>
                <Pause className="w-4 h-4" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" />
                <span>Play</span>
              </>
            )}
          </button>

          {/* Step Frame Forward */}
          <button
            type="button"
            onClick={() => onStepFrame(1)}
            title="Step Forward 1 Frame (Right Arrow)"
            className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Middle: Timecode & Frame Counter */}
        <div className="flex items-center space-x-3 bg-slate-900/90 px-3.5 py-1.5 rounded-xl border border-slate-800 font-mono text-xs">
          <span className="text-emerald-400 font-semibold">{formatTime(currentTime)}</span>
          <span className="text-slate-600">/</span>
          <span className="text-slate-400">{formatTime(duration)}</span>
          <span className="text-slate-700">|</span>
          <span className="text-slate-400">
            Frame <span className="text-white">{currentFrame}</span> / {totalFrames}
          </span>
        </div>

        {/* Right: Keyframing Controls (For Moving Watermark) */}
        {isMovingWatermarkMode && (
          <div className="flex items-center space-x-2">
            {activeKeyframe ? (
              <button
                type="button"
                onClick={onRemoveCurrentKeyframe}
                className="px-3 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 border border-rose-800/80 text-rose-300 flex items-center space-x-1 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Keyframe</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onAddKeyframe}
                className="px-3 py-1.5 rounded-lg bg-teal-950/60 hover:bg-teal-900 border border-teal-800/80 text-teal-300 flex items-center space-x-1 transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-teal-400" />
                <span>Add Keyframe @ {currentTime.toFixed(2)}s</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
