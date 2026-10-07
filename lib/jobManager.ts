import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { JobProgress, VideoMetadata, PreviewResponse, MaskSpec, InpaintOptions } from "@/types";

interface JobRecord {
  job: JobProgress;
  inputPath: string;
  outputPath: string;
  subscribers: Array<(job: JobProgress) => void>;
}

const jobs = new Map<string, JobRecord>();

// Paths configuration
export const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
export const OUTPUT_DIR = path.join(process.cwd(), "public", "outputs");
export const SAMPLES_DIR = path.join(process.cwd(), "public", "samples");
export const PYTHON_SCRIPT = path.join(process.cwd(), "backend", "inpaint_engine.py");

// Ensure directories exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(SAMPLES_DIR)) fs.mkdirSync(SAMPLES_DIR, { recursive: true });

export function getJob(jobId: string): JobProgress | null {
  const record = jobs.get(jobId);
  return record ? record.job : null;
}

export function subscribeJob(jobId: string, listener: (job: JobProgress) => void): () => void {
  const record = jobs.get(jobId);
  if (record) {
    record.subscribers.push(listener);
    listener(record.job);
    return () => {
      record.subscribers = record.subscribers.filter((s) => s !== listener);
    };
  }
  return () => {};
}

export function registerJob(jobId: string, inputPath: string, inputUrl: string, metadata?: VideoMetadata): JobProgress {
  const outputPath = path.join(OUTPUT_DIR, `${jobId}_cleaned.mp4`);
  const resultUrl = `/outputs/${jobId}_cleaned.mp4`;

  const initialJob: JobProgress = {
    jobId,
    stage: "Ready to process",
    progress: 0,
    frame: 0,
    total_frames: metadata?.total_frames || 0,
    status: "queued",
    inputUrl,
    resultUrl,
    metadata,
  };

  jobs.set(jobId, {
    job: initialJob,
    inputPath,
    outputPath,
    subscribers: [],
  });

  return initialJob;
}

export async function extractVideoMetadata(videoPath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const pythonExe = process.env.PYTHON_PATH || "python";
    const proc = spawn(pythonExe, [PYTHON_SCRIPT, "--mode", "metadata", "--input", videoPath]);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          const meta = JSON.parse(stdout);
          resolve(meta);
        } catch (err) {
          reject(new Error(`Failed to parse metadata JSON: ${stdout}`));
        }
      } else {
        reject(new Error(`Metadata extraction failed with code ${code}: ${stderr || stdout}`));
      }
    });
  });
}

export async function runPreviewInpaint(
  inputVideo: string,
  timestamp: number,
  maskSpec: MaskSpec,
  options: InpaintOptions
): Promise<PreviewResponse> {
  return new Promise((resolve, reject) => {
    const pythonExe = process.env.PYTHON_PATH || "python";
    const maskJson = JSON.stringify(maskSpec);

    const args = [
      PYTHON_SCRIPT,
      "--mode", "preview",
      "--input", inputVideo,
      "--time", timestamp.toString(),
      "--mask", maskJson,
      "--dilation", options.dilation.toString(),
      "--feather", options.feather.toString(),
      "--method", options.method,
    ];

    const proc = spawn(pythonExe, args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          const res = JSON.parse(stdout.trim());
          resolve(res);
        } catch (err) {
          reject(new Error(`Failed to parse preview response: ${stdout}`));
        }
      } else {
        reject(new Error(`Preview failed with code ${code}: ${stderr || stdout}`));
      }
    });
  });
}

export function startInpaintJob(
  jobId: string,
  maskSpec: MaskSpec,
  options: InpaintOptions
): void {
  const record = jobs.get(jobId);
  if (!record) throw new Error(`Job ${jobId} not found`);

  record.job.status = "processing";
  record.job.stage = "Starting inpainting engine...";
  record.job.progress = 1;
  notifySubscribers(record);

  const pythonExe = process.env.PYTHON_PATH || "python";
  const maskJson = JSON.stringify(maskSpec);

  const args = [
    "-u",
    PYTHON_SCRIPT,
    "--mode", "process",
    "--input", record.inputPath,
    "--output", record.outputPath,
    "--mask", maskJson,
    "--dilation", options.dilation.toString(),
    "--feather", options.feather.toString(),
    "--method", options.method,
    "--temporal_window", options.temporalWindow.toString(),
  ];

  const proc = spawn(pythonExe, args);
  let stdoutBuffer = "";

  proc.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const update = JSON.parse(trimmed);
        if (update.progress !== undefined) {
          record.job.progress = update.progress;
          record.job.stage = update.stage || record.job.stage;
          record.job.frame = update.frame || record.job.frame;
          record.job.total_frames = update.total_frames || record.job.total_frames;
          record.job.fps = update.fps;
          record.job.eta_seconds = update.eta_seconds;
          record.job.elapsed_seconds = update.elapsed_seconds;
          notifySubscribers(record);
        }
        if (update.status === "completed") {
          record.job.status = "completed";
          record.job.progress = 100;
          record.job.stage = "Video ready for download";
          record.job.output_video = update.output_video;
          notifySubscribers(record);
        }
      } catch (err) {
        // Non-JSON line from python log
      }
    }
  });

  let stderrOutput = "";
  proc.stderr.on("data", (chunk) => {
    stderrOutput += chunk.toString();
  });

  proc.on("close", (code) => {
    if (code === 0 && fs.existsSync(record.outputPath)) {
      record.job.status = "completed";
      record.job.progress = 100;
      record.job.stage = "Complete";
      notifySubscribers(record);
    } else if (record.job.status !== "completed") {
      record.job.status = "failed";
      record.job.error = `Inpainting failed (exit code ${code}): ${stderrOutput || "Unknown error"}`;
      notifySubscribers(record);
    }
  });
}

function notifySubscribers(record: JobRecord) {
  for (const sub of record.subscribers) {
    try {
      sub({ ...record.job });
    } catch (e) {
      // subscriber error
    }
  }
}

// Automatic cleanup of files older than 2 hours
export function cleanupOldFiles(): void {
  const maxAgeMs = 2 * 60 * 60 * 1000; // 2 hours
  const now = Date.now();

  [UPLOAD_DIR, OUTPUT_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) return;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
        }
      }
    } catch (err) {
      // silent cleanup fail
    }
  });
}

// Run cleanup every 30 minutes
setInterval(cleanupOldFiles, 30 * 60 * 1000);
