"use client";

import React, { useState } from "react";
import { Header } from "@/components/Header";
import { HeroStepBar, StepId } from "@/components/HeroStepBar";
import { VideoUploader } from "@/components/VideoUploader";
import { MaskCanvasEditor } from "@/components/MaskCanvasEditor";
import { ProcessingView } from "@/components/ProcessingView";
import { ResultPreview } from "@/components/ResultPreview";
import { VideoMetadata, MaskSpec, InpaintOptions, JobProgress, HardwareInfo } from "@/types";
import { startVideoProcess } from "@/lib/api";

export default function Home() {
  const [currentStep, setCurrentStep] = useState<StepId>("upload");
  const [jobId, setJobId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("video.mp4");
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [initialMask, setInitialMask] = useState<any>(null);
  const [activeJob, setActiveJob] = useState<JobProgress | null>(null);
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);

  // Step 1 -> Step 2: When video is uploaded or sample loaded
  const handleVideoLoaded = (data: {
    jobId: string;
    videoUrl: string;
    fileName: string;
    metadata: VideoMetadata;
    defaultMask?: any;
  }) => {
    setJobId(data.jobId);
    setVideoUrl(data.videoUrl);
    setFileName(data.fileName);
    setMetadata(data.metadata);
    setInitialMask(data.defaultMask || null);
    if (data.metadata?.hardware) {
      setHardware(data.metadata.hardware);
    }
    setCurrentStep("mask");
  };

  // Step 2 -> Step 3: When user clicks "Clean Entire Video"
  const handleStartProcessing = async (config: {
    maskSpec: MaskSpec;
    options: InpaintOptions;
  }) => {
    if (!jobId) return;

    try {
      await startVideoProcess({
        jobId,
        maskSpec: config.maskSpec,
        dilation: config.options.dilation,
        feather: config.options.feather,
        method: config.options.method,
        temporalWindow: config.options.temporalWindow,
      });

      setCurrentStep("process");
    } catch (err: any) {
      alert(`Error starting inpainting: ${err.message}`);
    }
  };

  // Step 3 -> Step 4: When inpainting completes
  const handleJobCompleted = (completedJob: JobProgress) => {
    setActiveJob(completedJob);
    setCurrentStep("result");
  };

  const handleJobFailed = (error: string) => {
    // handled inside ProcessingView with retry/error display
  };

  const handleReset = () => {
    setJobId(null);
    setVideoUrl(null);
    setFileName("video.mp4");
    setMetadata(null);
    setInitialMask(null);
    setActiveJob(null);
    setCurrentStep("upload");
  };

  const handleAdjustMask = () => {
    setCurrentStep("mask");
  };

  const canNavigateTo = (step: StepId): boolean => {
    if (step === "upload") return true;
    if (step === "mask") return !!videoUrl && !!metadata;
    if (step === "process") return !!jobId;
    if (step === "result") return !!activeJob && activeJob.status === "completed";
    return false;
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#090d16] text-slate-100">
      {/* Header */}
      <Header hardware={hardware} />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col">
        {/* Step Wizard Bar */}
        <HeroStepBar
          currentStep={currentStep}
          onStepClick={(step) => setCurrentStep(step)}
          canNavigateTo={canNavigateTo}
        />

        {/* Dynamic Step View */}
        <div className="flex-1 flex flex-col justify-center">
          {currentStep === "upload" && (
            <VideoUploader onVideoLoaded={handleVideoLoaded} />
          )}

          {currentStep === "mask" && jobId && videoUrl && metadata && (
            <MaskCanvasEditor
              jobId={jobId}
              videoUrl={videoUrl}
              fileName={fileName}
              metadata={metadata}
              initialMask={initialMask}
              onStartProcessing={handleStartProcessing}
              onBackToUpload={handleReset}
            />
          )}

          {currentStep === "process" && jobId && (
            <ProcessingView
              jobId={jobId}
              onCompleted={handleJobCompleted}
              onFailed={handleJobFailed}
            />
          )}

          {currentStep === "result" && activeJob && (
            <ResultPreview
              job={activeJob}
              onReset={handleReset}
              onAdjustMask={handleAdjustMask}
            />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-slate-900 bg-slate-950/60 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            <span className="font-semibold text-slate-400">CleanCut AI</span> — Clean your videos, not your quality.
          </div>
          <div>
            Local & Open-Source Inpainting Pipeline • Lossless Audio Preservation • No Cloud API Fees
          </div>
        </div>
      </footer>
    </div>
  );
}
