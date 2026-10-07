import { NextRequest, NextResponse } from "next/server";
import { getJob, runPreviewInpaint } from "@/lib/jobManager";
import { MaskSpec, InpaintOptions } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      jobId,
      timestamp = 0.0,
      maskSpec,
      dilation = 4,
      feather = 5,
      method = "ns",
      temporalWindow = 2,
    } = body as {
      jobId: string;
      timestamp: number;
      maskSpec: MaskSpec;
      dilation?: number;
      feather?: number;
      method?: "ns" | "telea";
      temporalWindow?: number;
    };

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    const job = getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const inputPath = (job as any).inputPath || pathFromUrl(job.inputUrl);
    if (!inputPath) {
      return NextResponse.json({ error: "Input video path could not be resolved" }, { status: 404 });
    }

    const inpaintOptions: InpaintOptions = {
      dilation: Number(dilation) || 4,
      feather: Number(feather) || 5,
      method: method === "telea" ? "telea" : "ns",
      temporalWindow: Number(temporalWindow) || 2,
    };

    const previewResult = await runPreviewInpaint(
      inputPath,
      Number(timestamp) || 0,
      maskSpec,
      inpaintOptions
    );

    return NextResponse.json(previewResult);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to generate preview" }, { status: 500 });
  }
}

function pathFromUrl(url?: string): string | null {
  if (!url) return null;
  const path = require("path");
  const fs = require("fs");
  const cleanUrl = url.split("?")[0];
  const fullPath = path.join(process.cwd(), "public", cleanUrl.replace(/^\//, ""));
  if (fs.existsSync(fullPath)) return fullPath;
  return null;
}
