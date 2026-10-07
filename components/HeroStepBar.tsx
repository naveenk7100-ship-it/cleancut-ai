"use client";

import React from "react";
import { Upload, Edit3, Wand2, Download, Check } from "lucide-react";

export type StepId = "upload" | "mask" | "process" | "result";

interface HeroStepBarProps {
  currentStep: StepId;
  onStepClick?: (step: StepId) => void;
  canNavigateTo?: (step: StepId) => boolean;
}

const steps: Array<{ id: StepId; number: number; label: string; icon: React.ElementType }> = [
  { id: "upload", number: 1, label: "Upload Video", icon: Upload },
  { id: "mask", number: 2, label: "Mark Watermark", icon: Edit3 },
  { id: "process", number: 3, label: "Inpaint & Clean", icon: Wand2 },
  { id: "result", number: 4, label: "Preview & Download", icon: Download },
];

export const HeroStepBar: React.FC<HeroStepBarProps> = ({
  currentStep,
  onStepClick,
  canNavigateTo,
}) => {
  const currentIdx = steps.findIndex((s) => s.id === currentStep);

  return (
    <div className="w-full max-w-4xl mx-auto my-6 px-4">
      <div className="relative flex items-center justify-between">
        {/* Background Connecting Line */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-slate-800 rounded-full z-0">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${(currentIdx / (steps.length - 1)) * 100}%`,
            }}
          />
        </div>

        {/* Step Nodes */}
        {steps.map((step, idx) => {
          const isCompleted = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const isClickable = canNavigateTo ? canNavigateTo(step.id) : false;
          const Icon = step.icon;

          return (
            <div
              key={step.id}
              onClick={() => isClickable && onStepClick && onStepClick(step.id)}
              className={`relative z-10 flex flex-col items-center group ${
                isClickable ? "cursor-pointer" : "cursor-default"
              }`}
            >
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                  isCompleted
                    ? "bg-emerald-600 border-emerald-400 text-white shadow-lg shadow-emerald-500/30"
                    : isCurrent
                    ? "bg-slate-900 border-emerald-400 text-emerald-400 shadow-xl shadow-emerald-500/40 ring-4 ring-emerald-500/20 scale-110"
                    : "bg-slate-900 border-slate-700 text-slate-500"
                }`}
              >
                {isCompleted ? (
                  <Check className="w-5 h-5 text-white stroke-[3]" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
              </div>
              <span
                className={`mt-2 text-xs font-medium tracking-wide transition-colors duration-200 text-center ${
                  isCurrent
                    ? "text-emerald-400 font-semibold"
                    : isCompleted
                    ? "text-slate-300"
                    : "text-slate-500"
                }`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
