import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { registerJob, extractVideoMetadata, UPLOAD_DIR } from "@/lib/jobManager";

export const dynamic = "force-dynamic";

const ALLOWED_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv", ".avi"];
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No video file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File exceeds maximum allowed size of 500MB (${(file.size / (1024 * 1024)).toFixed(1)}MB)` },
        { status: 400 }
      );
    }

    const originalName = file.name || "video.mp4";
    const ext = path.extname(originalName).toLowerCase() || ".mp4";

    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        { error: `Unsupported format: ${ext}. Please upload MP4, MOV, WebM, or MKV.` },
        { status: 400 }
      );
    }

    const jobId = "cc_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 7);
    const fileName = `${jobId}_input${ext}`;
    const filePath = path.join(UPLOAD_DIR, fileName);

    // Write file to disk
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.promises.writeFile(filePath, buffer);

    const videoUrl = `/uploads/${fileName}`;

    // Extract metadata
    try {
      const metadata = await extractVideoMetadata(filePath);
      const job = registerJob(jobId, filePath, videoUrl, metadata);

      return NextResponse.json({
        success: true,
        jobId,
        videoUrl,
        fileName: originalName,
        metadata,
        job,
      });
    } catch (metaErr: any) {
      // Clean up failed file
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return NextResponse.json(
        { error: `Invalid or unreadable video file: ${metaErr.message}` },
        { status: 422 }
      );
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: `Upload failed: ${error.message || "Unknown error"}` },
      { status: 500 }
    );
  }
}
