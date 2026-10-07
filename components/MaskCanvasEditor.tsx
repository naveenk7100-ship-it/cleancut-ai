"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Square,
  Brush,
  Eraser,
  RotateCcw,
  Sliders,
  Layers,
  Sparkles,
  Eye,
  Key,
  HelpCircle,
  Play,
  Pause,
  ChevronRight,
  Loader2,
  AlertTriangle,
  Move,
  Maximize2
} from "lucide-react";
import { VideoTimelineScrubber } from "./VideoTimelineScrubber";
import { PreviewTestModal } from "./PreviewTestModal";
import { VideoMetadata, Keyframe, Point, MaskPath, MaskSpec, InpaintOptions, PreviewResponse } from "@/types";
import { requestFramePreview } from "@/lib/api";

interface MaskCanvasEditorProps {
  jobId: string;
  videoUrl: string;
  fileName: string;
  metadata: VideoMetadata;
  initialMask?: any;
  onStartProcessing: (config: {
    maskSpec: MaskSpec;
    options: InpaintOptions;
  }) => void;
  onBackToUpload: () => void;
}

type ToolMode = "rect" | "brush" | "eraser";
type TrackingMode = "fixed" | "moving";

export const MaskCanvasEditor: React.FC<MaskCanvasEditorProps> = ({
  jobId,
  videoUrl,
  fileName,
  metadata,
  initialMask,
  onStartProcessing,
  onBackToUpload,
}) => {
  // Video & Playback state
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const duration = metadata.duration || 1.0;

  // Mask & Tracking configuration
  const [trackingMode, setTrackingMode] = useState<TrackingMode>(
    initialMask?.type === "keyframes" ? "moving" : "fixed"
  );
  const [toolMode, setToolMode] = useState<ToolMode>("rect");
  const [brushRadius, setBrushRadius] = useState(25);
  const [featherRadius, setFeatherRadius] = useState(5);
  const [dilationRadius, setDilationRadius] = useState(4);
  const [algorithm, setAlgorithm] = useState<"ns" | "telea">("ns");
  const [temporalWindow, setTemporalWindow] = useState(2);

  // Rectangle & Keyframe state
  const [rectBox, setRectBox] = useState<{ x: number; y: number; width: number; height: number } | null>(
    initialMask?.rect
      ? initialMask.rect
      : {
          x: Math.round(metadata.width * 0.7),
          y: Math.round(metadata.height * 0.08),
          width: Math.round(metadata.width * 0.25),
          height: Math.round(metadata.height * 0.1),
        }
  );

  const [keyframes, setKeyframes] = useState<Keyframe[]>(
    initialMask?.keyframes || [
      {
        time: 0.0,
        x: Math.round(metadata.width * 0.7),
        y: Math.round(metadata.height * 0.08),
        width: Math.round(metadata.width * 0.25),
        height: Math.round(metadata.height * 0.1),
      },
      {
        time: duration,
        x: Math.round(metadata.width * 0.7),
        y: Math.round(metadata.height * 0.08),
        width: Math.round(metadata.width * 0.25),
        height: Math.round(metadata.height * 0.1),
      },
    ]
  );

  // Brush Paths state
  const [brushPaths, setBrushPaths] = useState<MaskPath[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Point[] | null>(null);

  // Dragging & Interaction state for Rect Tool
  const [isDrawing, setIsDrawing] = useState(false);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [isMovingRect, setIsMovingRect] = useState(false);
  const [rectDragOffset, setRectDragOffset] = useState<Point | null>(null);

  // Single Frame Preview Modal state
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<PreviewResponse | null>(null);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Helper: Get active interpolated box at given timestamp
  const getInterpolatedBoxAtTime = useCallback(
    (time: number) => {
      if (trackingMode === "fixed") {
        return rectBox;
      }
      if (!keyframes || keyframes.length === 0) return rectBox;

      const sorted = [...keyframes].sort((a, b) => a.time - b.time);
      if (time <= sorted[0].time) return sorted[0];
      if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1];

      for (let i = 0; i < sorted.length - 1; i++) {
        const k1 = sorted[i];
        const k2 = sorted[i + 1];
        if (k1.time <= time && time <= k2.time) {
          const alpha = (time - k1.time) / (k2.time - k1.time);
          return {
            x: Math.round((1 - alpha) * k1.x + alpha * k2.x),
            y: Math.round((1 - alpha) * k1.y + alpha * k2.y),
            width: Math.round((1 - alpha) * k1.width + alpha * k2.width),
            height: Math.round((1 - alpha) * k1.height + alpha * k2.height),
          };
        }
      }
      return sorted[0];
    },
    [trackingMode, rectBox, keyframes]
  );

  // Convert client click coordinates on Canvas to native video pixel coordinates
  const canvasToVideoCoords = useCallback(
    (clientX: number, clientY: number): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();

      const scaleX = metadata.width / rect.width;
      const scaleY = metadata.height / rect.height;

      const x = Math.max(0, Math.min(metadata.width, (clientX - rect.left) * scaleX));
      const y = Math.max(0, Math.min(metadata.height, (clientY - rect.top) * scaleY));

      return { x: Math.round(x), y: Math.round(y) };
    },
    [metadata.width, metadata.height]
  );

  // Draw overlay canvas
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Draw Brush Paths
    brushPaths.forEach((path) => {
      if (path.points.length < 2) return;
      ctx.beginPath();
      ctx.lineWidth = path.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(239, 68, 68, 0.6)"; // Semi-transparent red
      ctx.moveTo(path.points[0].x, path.points[0].y);
      for (let i = 1; i < path.points.length; i++) {
        ctx.lineTo(path.points[i].x, path.points[i].y);
      }
      ctx.stroke();
    });

    // 2. Draw Current Active Stroke if drawing
    if (currentStroke && currentStroke.length > 0) {
      ctx.beginPath();
      ctx.lineWidth = brushRadius;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = toolMode === "eraser" ? "rgba(0, 0, 0, 0.8)" : "rgba(239, 68, 68, 0.7)";
      ctx.moveTo(currentStroke[0].x, currentStroke[0].y);
      for (let i = 1; i < currentStroke.length; i++) {
        ctx.lineTo(currentStroke[i].x, currentStroke[i].y);
      }
      ctx.stroke();
    }

    // 3. Draw Watermark Bounding Box
    const activeBox = getInterpolatedBoxAtTime(currentTime);
    if (activeBox && activeBox.width > 0 && activeBox.height > 0) {
      // Box fill with diagonal striped pattern or semi-transparent red
      ctx.fillStyle = "rgba(239, 68, 68, 0.35)";
      ctx.fillRect(activeBox.x, activeBox.y, activeBox.width, activeBox.height);

      // Box border
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#ef4444";
      ctx.strokeRect(activeBox.x, activeBox.y, activeBox.width, activeBox.height);

      // Corner handles
      const handleSize = Math.max(8, Math.min(24, Math.round(metadata.width * 0.012)));
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;

      // Top-Left, Top-Right, Bottom-Left, Bottom-Right
      const corners = [
        [activeBox.x, activeBox.y],
        [activeBox.x + activeBox.width, activeBox.y],
        [activeBox.x, activeBox.y + activeBox.height],
        [activeBox.x + activeBox.width, activeBox.y + activeBox.height],
      ];

      corners.forEach(([cx, cy]) => {
        ctx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
      });

      // Label badge
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      ctx.fillRect(activeBox.x, Math.max(0, activeBox.y - 28), 160, 24);
      ctx.fillStyle = "#34d399";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText(
        trackingMode === "moving" ? "Target Watermark [Tracked]" : "Target Watermark [Fixed]",
        activeBox.x + 6,
        Math.max(16, activeBox.y - 11)
      );
    }
  }, [
    brushPaths,
    currentStroke,
    brushRadius,
    toolMode,
    getInterpolatedBoxAtTime,
    currentTime,
    metadata.width,
    trackingMode,
  ]);

  // Redraw when state updates
  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  // Video time update event
  const handleVideoTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleSeek = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleTogglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleStepFrame = (direction: number) => {
    if (!videoRef.current) return;
    const fps = metadata.fps || 30;
    const nextTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + direction * (1 / fps)));
    videoRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  // Add / Update Keyframe for moving watermark mode
  const handleAddKeyframe = () => {
    const currentBox = getInterpolatedBoxAtTime(currentTime) || {
      x: 100,
      y: 100,
      width: 200,
      height: 80,
    };
    const newKf: Keyframe = {
      time: Number(currentTime.toFixed(2)),
      x: currentBox.x,
      y: currentBox.y,
      width: currentBox.width,
      height: currentBox.height,
    };

    // Replace if close, or insert sorted
    const filtered = keyframes.filter((k) => Math.abs(k.time - currentTime) >= 0.1);
    const updated = [...filtered, newKf].sort((a, b) => a.time - b.time);
    setKeyframes(updated);
  };

  const handleRemoveCurrentKeyframe = () => {
    const updated = keyframes.filter((k) => Math.abs(k.time - currentTime) >= 0.1);
    setKeyframes(updated.length > 0 ? updated : keyframes);
  };

  // Canvas Mouse & Touch interaction
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pt = canvasToVideoCoords(e.clientX, e.clientY);
    setIsDrawing(true);
    setDragStart(pt);

    if (toolMode === "rect") {
      const activeBox = getInterpolatedBoxAtTime(currentTime);
      if (
        activeBox &&
        pt.x >= activeBox.x &&
        pt.x <= activeBox.x + activeBox.width &&
        pt.y >= activeBox.y &&
        pt.y <= activeBox.y + activeBox.height
      ) {
        setIsMovingRect(true);
        setRectDragOffset({ x: pt.x - activeBox.x, y: pt.y - activeBox.y });
      } else {
        setIsMovingRect(false);
        setRectDragOffset(null);
        setRectBox({ x: pt.x, y: pt.y, width: 0, height: 0 });
      }
    } else {
      // Brush or Eraser
      setCurrentStroke([pt]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !dragStart) return;
    const pt = canvasToVideoCoords(e.clientX, e.clientY);

    if (toolMode === "rect") {
      if (isMovingRect && rectDragOffset) {
        const activeBox = getInterpolatedBoxAtTime(currentTime);
        if (!activeBox) return;
        const newX = Math.max(0, Math.min(metadata.width - activeBox.width, pt.x - rectDragOffset.x));
        const newY = Math.max(0, Math.min(metadata.height - activeBox.height, pt.y - rectDragOffset.y));
        const movedBox = { ...activeBox, x: newX, y: newY };

        if (trackingMode === "moving") {
          // Update keyframe at current time
          const filtered = keyframes.filter((k) => Math.abs(k.time - currentTime) >= 0.1);
          setKeyframes(
            [...filtered, { time: Number(currentTime.toFixed(2)), ...movedBox }].sort((a, b) => a.time - b.time)
          );
        } else {
          setRectBox(movedBox);
        }
      } else {
        const x = Math.min(dragStart.x, pt.x);
        const y = Math.min(dragStart.y, pt.y);
        const width = Math.abs(pt.x - dragStart.x);
        const height = Math.abs(pt.y - dragStart.y);
        const drawnBox = { x, y, width, height };

        if (trackingMode === "moving") {
          const filtered = keyframes.filter((k) => Math.abs(k.time - currentTime) >= 0.1);
          setKeyframes(
            [...filtered, { time: Number(currentTime.toFixed(2)), ...drawnBox }].sort((a, b) => a.time - b.time)
          );
        } else {
          setRectBox(drawnBox);
        }
      }
    } else {
      // Brush / Eraser
      if (currentStroke) {
        setCurrentStroke((prev) => (prev ? [...prev, pt] : [pt]));
      }
    }
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
    setIsMovingRect(false);
    setRectDragOffset(null);

    if (toolMode === "brush" && currentStroke && currentStroke.length > 0) {
      setBrushPaths((prev) => [...prev, { points: currentStroke, width: brushRadius }]);
      setCurrentStroke(null);
    }
  };

  // Build current MaskSpec
  const buildCurrentMaskSpec = (): MaskSpec => {
    if (brushPaths.length > 0) {
      return {
        type: "brush",
        paths: brushPaths,
        rect: rectBox || undefined,
      };
    }

    if (trackingMode === "moving" && keyframes.length > 0) {
      return {
        type: "keyframes",
        keyframes: keyframes,
      };
    }

    return {
      type: "rectangle",
      rect: rectBox || {
        x: Math.round(metadata.width * 0.7),
        y: Math.round(metadata.height * 0.08),
        width: Math.round(metadata.width * 0.25),
        height: Math.round(metadata.height * 0.1),
      },
    };
  };

  // Run Single Frame Inpaint Preview Test
  const handleTestPreview = async () => {
    setErrorMessage(null);
    setIsPreviewLoading(true);
    const maskSpec = buildCurrentMaskSpec();

    try {
      const data = await requestFramePreview({
        jobId,
        timestamp: currentTime,
        maskSpec,
        dilation: dilationRadius,
        feather: featherRadius,
        method: algorithm,
        temporalWindow,
      });

      setPreviewResult(data);
      setIsPreviewModalOpen(true);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to generate preview");
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Handle Complete Video Process CTA
  const handleProcessVideo = () => {
    const maskSpec = buildCurrentMaskSpec();
    const inpaintOptions: InpaintOptions = {
      dilation: dilationRadius,
      feather: featherRadius,
      method: algorithm,
      temporalWindow,
    };

    onStartProcessing({ maskSpec, options: inpaintOptions });
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 animate-fadeIn pb-12">
      {/* Top Header & Back Button */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onBackToUpload}
              className="text-xs text-slate-400 hover:text-white transition-colors"
            >
              ← Upload new video
            </button>
            <span className="text-slate-600">/</span>
            <span className="text-xs text-emerald-400 font-mono">{fileName}</span>
          </div>
          <h2 className="text-2xl font-bold text-white mt-1">Mark Watermark Area</h2>
        </div>

        {/* Video Specs Pills */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 font-mono">
            {metadata.width} × {metadata.height} ({metadata.width > metadata.height ? "16:9 Landscape" : "9:16 Portrait"})
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 font-mono">
            {metadata.fps} FPS
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 font-mono">
            {duration.toFixed(1)}s Duration
          </span>
          {metadata.has_audio && (
            <span className="px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-800/60 text-emerald-400 font-mono">
              Audio: {metadata.audio_codec.split(" ")[0]}
            </span>
          )}
        </div>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-800 text-rose-300 text-sm flex items-start space-x-2">
          <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Main Workspace Layout (Video + Canvas / Right Toolbar) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left 3 Columns: Video Player with Overlaid Canvas */}
        <div className="lg:col-span-3 space-y-4">
          <div
            ref={containerRef}
            className="relative w-full rounded-2xl overflow-hidden bg-black border border-slate-800 shadow-2xl flex items-center justify-center select-none"
            style={{ minHeight: "380px", maxHeight: "68vh" }}
          >
            {/* HTML5 Video Element */}
            <video
              ref={videoRef}
              src={videoUrl}
              onTimeUpdate={handleVideoTimeUpdate}
              onEnded={() => setIsPlaying(false)}
              playsInline
              preload="auto"
              className="w-full h-full object-contain pointer-events-none max-h-[68vh]"
            />

            {/* Interactive Drawing Canvas Layer */}
            <canvas
              ref={canvasRef}
              width={metadata.width}
              height={metadata.height}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              className="absolute inset-0 w-full h-full object-contain cursor-crosshair z-20"
            />
          </div>

          {/* Precision Video Timeline Scrubber */}
          <VideoTimelineScrubber
            currentTime={currentTime}
            duration={duration}
            isPlaying={isPlaying}
            keyframes={keyframes}
            onSeek={handleSeek}
            onTogglePlay={handleTogglePlay}
            onStepFrame={handleStepFrame}
            onAddKeyframe={handleAddKeyframe}
            onRemoveCurrentKeyframe={handleRemoveCurrentKeyframe}
            fps={metadata.fps}
            isMovingWatermarkMode={trackingMode === "moving"}
          />
        </div>

        {/* Right Column: Mask Tools & Inpainting Settings */}
        <div className="space-y-5 bg-slate-900/80 border border-slate-800/90 rounded-2xl p-5 backdrop-blur-sm">
          {/* Tracking Mode Switcher */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center justify-between">
              <span>Watermark Type</span>
              <span className="text-[10px] text-emerald-400 lowercase font-normal">auto-tracking</span>
            </label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setTrackingMode("fixed")}
                className={`py-2 px-3 rounded-lg font-medium transition-all ${
                  trackingMode === "fixed"
                    ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/30"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Fixed Position
              </button>
              <button
                type="button"
                onClick={() => setTrackingMode("moving")}
                className={`py-2 px-3 rounded-lg font-medium transition-all ${
                  trackingMode === "moving"
                    ? "bg-teal-600 text-white shadow-md shadow-teal-600/30"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Moving / Animated
              </button>
            </div>
            {trackingMode === "moving" && (
              <p className="text-[11px] text-teal-300/80 bg-teal-950/40 p-2 rounded-lg border border-teal-800/40">
                💡 Tip: Scrub timeline to start & end points and reposition the box. The engine interpolates the movement across all frames.
              </p>
            )}
          </div>

          {/* Tool Mode Buttons */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Drawing Tool
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setToolMode("rect")}
                className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs transition-all ${
                  toolMode === "rect"
                    ? "bg-emerald-500/10 border-emerald-500 text-emerald-400"
                    : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                <Square className="w-4 h-4 mb-1" />
                <span>Box</span>
              </button>

              <button
                type="button"
                onClick={() => setToolMode("brush")}
                className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs transition-all ${
                  toolMode === "brush"
                    ? "bg-emerald-500/10 border-emerald-500 text-emerald-400"
                    : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                <Brush className="w-4 h-4 mb-1" />
                <span>Brush</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setBrushPaths([]);
                  setRectBox(null);
                }}
                className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:text-rose-400 hover:border-rose-800/60 text-xs transition-all"
              >
                <RotateCcw className="w-4 h-4 mb-1" />
                <span>Clear</span>
              </button>
            </div>
          </div>

          {/* Brush Size Slider (if brush active) */}
          {toolMode === "brush" && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-300">
                <span>Brush Size</span>
                <span className="font-mono text-emerald-400">{brushRadius}px</span>
              </div>
              <input
                type="range"
                min="5"
                max="80"
                value={brushRadius}
                onChange={(e) => setBrushRadius(Number(e.target.value))}
                className="w-full accent-emerald-500 bg-slate-950 h-2 rounded-lg"
              />
            </div>
          )}

          {/* Edge Padding / Dilation Slider */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-slate-300">
              <span className="flex items-center space-x-1">
                <span>Edge Padding</span>
                <span title="Expands mask boundary to cover antialiased edges of text/logos" className="text-slate-500 cursor-help">ℹ️</span>
              </span>
              <span className="font-mono text-emerald-400">+{dilationRadius}px</span>
            </div>
            <input
              type="range"
              min="0"
              max="10"
              value={dilationRadius}
              onChange={(e) => setDilationRadius(Number(e.target.value))}
              className="w-full accent-emerald-500 bg-slate-950 h-2 rounded-lg"
            />
          </div>

          {/* Soft Edge Feathering Slider */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-slate-300">
              <span className="flex items-center space-x-1">
                <span>Soft Blend Feather</span>
                <span title="Feathers mask boundary with Gaussian alpha for seamless pixel gradient blending" className="text-slate-500 cursor-help">ℹ️</span>
              </span>
              <span className="font-mono text-emerald-400">{featherRadius}px</span>
            </div>
            <input
              type="range"
              min="0"
              max="20"
              value={featherRadius}
              onChange={(e) => setFeatherRadius(Number(e.target.value))}
              className="w-full accent-emerald-500 bg-slate-950 h-2 rounded-lg"
            />
          </div>

          {/* Algorithm Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Inpainting Algorithm</label>
            <select
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value as any)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="ns">Temporal + Navier-Stokes PDE (Recommended)</option>
              <option value="telea">Fast Marching Method (Telea)</option>
            </select>
          </div>

          {/* Action Buttons: Preview Frame & Full Process */}
          <div className="pt-2 space-y-2.5">
            {/* Test Single Frame Button */}
            <button
              type="button"
              disabled={isPreviewLoading}
              onClick={handleTestPreview}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 font-medium text-xs border border-slate-700 flex items-center justify-center space-x-2 transition-all"
            >
              {isPreviewLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                  <span>Testing Frame Inpaint...</span>
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4 text-emerald-400" />
                  <span>Preview Single Frame</span>
                </>
              )}
            </button>

            {/* Start Processing Complete Video */}
            <button
              type="button"
              onClick={handleProcessVideo}
              className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-500 to-cyan-500 hover:from-emerald-500 hover:to-cyan-400 text-white font-bold text-sm shadow-xl shadow-emerald-500/25 flex items-center justify-center space-x-2 transition-all transform hover:scale-[1.02]"
            >
              <Sparkles className="w-4 h-4" />
              <span>Clean Entire Video</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Single Frame Verification Modal */}
      <PreviewTestModal
        preview={previewResult}
        isOpen={isPreviewModalOpen}
        onClose={() => setIsPreviewModalOpen(false)}
        onApplyAndProcess={handleProcessVideo}
      />
    </div>
  );
};
