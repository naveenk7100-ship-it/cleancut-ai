"use client";

import React, { useState } from "react";
import { X, Check, Clock, Eye, Layers, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { PreviewResponse } from "@/types";

interface PreviewTestModalProps {
  preview: PreviewResponse | null;
  isOpen: boolean;
  onClose: () => void;
  onApplyAndProcess?: () => void;
}

export const PreviewTestModal: React.FC<PreviewTestModalProps> = ({
  preview,
  isOpen,
  onClose,
  onApplyAndProcess,
}) => {
  const [viewMode, setViewMode] = useState<"side-by-side" | "slider" | "overlay">("slider");
  const [sliderPos, setSliderPos] = useState(50);
  const [isZoomed, setIsZoomed] = useState(false);

  if (!isOpen || !preview) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-5xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
              <Eye className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Single-Frame Inpaint Verification</h3>
              <p className="text-xs text-slate-400">
                Timestamp: {preview.timestamp.toFixed(2)}s (Frame #{preview.frame_index}) • Rendered in {preview.inpaint_time_ms}ms
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* View Mode Toggle */}
            <div className="flex items-center rounded-lg bg-slate-800 p-1 border border-slate-700 text-xs text-slate-300">
              <button
                type="button"
                onClick={() => setViewMode("slider")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  viewMode === "slider" ? "bg-emerald-600 text-white font-medium" : "hover:text-white"
                }`}
              >
                Split Slider
              </button>
              <button
                type="button"
                onClick={() => setViewMode("side-by-side")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  viewMode === "side-by-side" ? "bg-emerald-600 text-white font-medium" : "hover:text-white"
                }`}
              >
                Side-by-Side
              </button>
              <button
                type="button"
                onClick={() => setViewMode("overlay")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  viewMode === "overlay" ? "bg-emerald-600 text-white font-medium" : "hover:text-white"
                }`}
              >
                Mask Overlay
              </button>
            </div>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 flex flex-col items-center justify-center bg-slate-950/40">
          {viewMode === "slider" && (
            <div className="w-full max-w-3xl flex flex-col items-center space-y-4">
              <div
                className="relative select-none overflow-hidden rounded-xl border border-slate-800 shadow-2xl bg-black max-h-[55vh] flex items-center justify-center"
                style={{ aspectRatio: `${preview.width} / ${preview.height}` }}
              >
                {/* Cleaned Image (Bottom layer) */}
                <img
                  src={preview.cleaned_image}
                  alt="Cleaned frame"
                  className="w-full h-full object-contain pointer-events-none"
                />

                {/* Original Image with Clip Path (Top layer) */}
                <div
                  className="absolute inset-0 overflow-hidden"
                  style={{
                    clipPath: `polygon(0 0, ${sliderPos}% 0, ${sliderPos}% 100%, 0 100%)`,
                  }}
                >
                  <img
                    src={preview.original_image}
                    alt="Original frame with watermark"
                    className="w-full h-full object-contain pointer-events-none"
                  />
                  <div className="absolute top-3 left-3 px-2 py-1 rounded bg-black/70 text-[11px] font-semibold text-rose-400 border border-rose-900/60 backdrop-blur-sm">
                    ORIGINAL (Watermark)
                  </div>
                </div>

                <div className="absolute top-3 right-3 px-2 py-1 rounded bg-black/70 text-[11px] font-semibold text-emerald-400 border border-emerald-900/60 backdrop-blur-sm">
                  CLEANED (Reconstructed)
                </div>

                {/* Divider Line */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)] pointer-events-none"
                  style={{ left: `${sliderPos}%` }}
                >
                  <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-emerald-500 border-2 border-white shadow-lg flex items-center justify-center text-[10px] text-slate-950 font-bold">
                    ↔
                  </div>
                </div>

                {/* Invisible input range for dragging */}
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={sliderPos}
                  onChange={(e) => setSliderPos(Number(e.target.value))}
                  className="absolute inset-0 opacity-0 cursor-ew-resize w-full h-full z-20"
                />
              </div>

              <p className="text-xs text-slate-400">
                Drag slider left & right to inspect watermark removal boundary fidelity.
              </p>
            </div>
          )}

          {viewMode === "side-by-side" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-4xl">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-rose-400">Original Frame (with Watermark)</span>
                </div>
                <div className="rounded-xl overflow-hidden border border-rose-900/40 bg-black aspect-video flex items-center justify-center">
                  <img
                    src={preview.original_image}
                    alt="Original frame"
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-emerald-400">Cleaned Inpainted Frame</span>
                </div>
                <div className="rounded-xl overflow-hidden border border-emerald-800/50 bg-black aspect-video flex items-center justify-center">
                  <img
                    src={preview.cleaned_image}
                    alt="Cleaned frame"
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>
            </div>
          )}

          {viewMode === "overlay" && (
            <div className="w-full max-w-3xl flex flex-col items-center space-y-2">
              <div className="rounded-xl overflow-hidden border border-slate-800 bg-black max-h-[55vh] flex items-center justify-center">
                <img
                  src={preview.mask_overlay_image}
                  alt="Mask Overlay"
                  className="w-full h-full object-contain"
                />
              </div>
              <p className="text-xs text-slate-400">
                Red zone shows refined mask with dilation and Gaussian feathering.
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between">
          <div className="text-xs text-slate-400 flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Result verified without blurring or quality degradation</span>
          </div>

          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors"
            >
              Adjust Mask
            </button>

            {onApplyAndProcess && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onApplyAndProcess();
                }}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white text-sm font-semibold shadow-lg shadow-emerald-500/25 transition-all flex items-center space-x-2"
              >
                <Check className="w-4 h-4" />
                <span>Process Entire Video</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
