import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getJob, OUTPUT_DIR } from "@/lib/jobManager";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const jobId = params.id;
  const job = getJob(jobId);

  // Look for output file
  const outputPath = path.join(OUTPUT_DIR, `${jobId}_cleaned.mp4`);

  if (!fs.existsSync(outputPath)) {
    return NextResponse.json({ error: "Cleaned video file not found or still processing" }, { status: 404 });
  }

  const stat = fs.statSync(outputPath);
  const fileStream = fs.createReadStream(outputPath);

  // Custom download filename
  const searchParams = req.nextUrl.searchParams;
  const rawFileName = searchParams.get("filename") || "CleanCut_video.mp4";
  const safeFileName = rawFileName.replace(/[^a-zA-Z0-9._-]/g, "_");

  const headers = new Headers();
  headers.set("Content-Type", "video/mp4");
  headers.set("Content-Length", stat.size.toString());
  headers.set("Content-Disposition", `attachment; filename="${safeFileName}"`);
  headers.set("Cache-Control", "public, max-age=3600");

  // @ts-ignore
  return new Response(fileStream as any, {
    status: 200,
    headers,
  });
}
