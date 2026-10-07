import { NextRequest, NextResponse } from "next/server";
import { getJob, startInpaintJob } from "@/lib/jobManager";
import { MaskSpec, InpaintOptions } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      jobId,
      maskSpec,
      dilation = 4,
      feather = 5,
      method = "ns",
      temporalWindow = 2,
    } = body as {
      jobId: string;
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

    if (job.status === "processing") {
      return NextResponse.json({ error: "Job is already processing" }, { status: 409 });
    }

    const inpaintOptions: InpaintOptions = {
      dilation: Number(dilation) || 4,
      feather: Number(feather) || 5,
      method: method === "telea" ? "telea" : "ns",
      temporalWindow: Number(temporalWindow) || 2,
    };

    // Start inpainting background job
    startInpaintJob(jobId, maskSpec, inpaintOptions);

    return NextResponse.json({
      success: true,
      jobId,
      status: "processing",
      message: "Video inpainting started",
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to start processing" }, { status: 500 });
  }
}
