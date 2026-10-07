import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { registerJob, extractVideoMetadata, SAMPLES_DIR } from "@/lib/jobManager";

export const dynamic = "force-dynamic";

const SAMPLES = [
  {
    id: "sample_landscape",
    title: "16:9 Landscape Video (Fixed Watermark)",
    description: "1280x720 video with camera movement, geometric background, audio melody, and fixed watermark badge.",
    fileName: "landscape_watermark_sample.mp4",
    videoUrl: "/samples/landscape_watermark_sample.mp4",
    defaultMask: {
      type: "rectangle" as const,
      rect: {
        x: 880,
        y: 50,
        width: 350,
        height: 70,
        is_normalized: false,
      },
    },
  },
  {
    id: "sample_portrait",
    title: "9:16 Portrait Video (Moving Watermark)",
    description: "720x1280 vertical video with moving watermark across frames and full keyframe interpolation.",
    fileName: "portrait_moving_watermark_sample.mp4",
    videoUrl: "/samples/portrait_moving_watermark_sample.mp4",
    defaultMask: {
      type: "keyframes" as const,
      keyframes: [
        { time: 0.0, x: 50, y: 150, width: 260, height: 60, is_normalized: false },
        { time: 4.0, x: 360, y: 800, width: 260, height: 60, is_normalized: false },
      ],
    },
  },
];

export async function GET() {
  return NextResponse.json({ samples: SAMPLES });
}

export async function POST(req: NextRequest) {
  try {
    const { sampleId } = await req.json();
    const sample = SAMPLES.find((s) => s.id === sampleId);

    if (!sample) {
      return NextResponse.json({ error: "Sample not found" }, { status: 404 });
    }

    const filePath = path.join(SAMPLES_DIR, sample.fileName);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Sample file missing on disk" }, { status: 404 });
    }

    const jobId = "sample_" + Date.now().toString(36);
    const metadata = await extractVideoMetadata(filePath);
    const job = registerJob(jobId, filePath, sample.videoUrl, metadata);

    return NextResponse.json({
      success: true,
      jobId,
      videoUrl: sample.videoUrl,
      fileName: sample.fileName,
      metadata,
      defaultMask: sample.defaultMask,
      job,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load sample" }, { status: 500 });
  }
}
