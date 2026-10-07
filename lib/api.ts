import { MaskSpec, InpaintOptions, PreviewResponse, JobProgress, VideoMetadata } from "@/types";

/**
 * Returns the base API URL configured in environment variables,
 * or falls back to empty string for relative paths.
 */
export function getApiBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  if (envUrl && envUrl.trim() !== "") {
    return envUrl.replace(/\/+$/, "");
  }
  return "";
}

/**
 * Health check to verify backend connectivity.
 */
export async function checkBackendHealth(): Promise<{
  ok: boolean;
  data?: any;
  error?: string;
}> {
  try {
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/health`, {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message || "Connection refused" };
  }
}

/**
 * Fetch list of sample video presets.
 */
export async function fetchSamples(): Promise<any[]> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/samples`, { method: "GET" });
  if (!res.ok) throw new Error("Failed to load sample videos");
  const data = await res.json();
  return data.samples || [];
}

/**
 * Load a sample video as an active job.
 */
export async function loadSamplePreset(sampleId: string): Promise<{
  jobId: string;
  videoUrl: string;
  fileName: string;
  metadata: VideoMetadata;
  defaultMask?: any;
  job: JobProgress;
}> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/samples`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sampleId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || "Failed to load sample video");
  }
  const data = await res.json();
  // If remote backend, prepend base URL to videoUrl if relative
  if (base && data.videoUrl && data.videoUrl.startsWith("/")) {
    data.videoUrl = `${base}${data.videoUrl}`;
  }
  return data;
}

/**
 * Upload a user video file to backend.
 */
export async function uploadVideoFile(file: File): Promise<{
  jobId: string;
  videoUrl: string;
  fileName: string;
  metadata: VideoMetadata;
  job: JobProgress;
}> {
  const base = getApiBaseUrl();
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${base}/api/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || "Failed to upload video");
  }

  const data = await res.json();
  if (base && data.videoUrl && data.videoUrl.startsWith("/")) {
    data.videoUrl = `${base}${data.videoUrl}`;
  }
  return data;
}

/**
 * Execute single-frame inpaint test.
 */
export async function requestFramePreview(params: {
  jobId: string;
  timestamp: number;
  maskSpec: MaskSpec;
  dilation: number;
  feather: number;
  method: "ns" | "telea";
  temporalWindow?: number;
}): Promise<PreviewResponse> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/preview-frame`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || "Failed to generate preview");
  }

  return res.json();
}

/**
 * Start full video inpainting job.
 */
export async function startVideoProcess(params: {
  jobId: string;
  maskSpec: MaskSpec;
  dilation: number;
  feather: number;
  method: "ns" | "telea";
  temporalWindow?: number;
}): Promise<{ success: boolean; jobId: string; message: string }> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || "Failed to start inpainting");
  }

  return res.json();
}

/**
 * Get SSE or polling status URL.
 */
export function getJobStreamUrl(jobId: string): string {
  const base = getApiBaseUrl();
  return `${base}/api/job/${jobId}`;
}

/**
 * Get direct download link for cleaned MP4.
 */
export function getDownloadUrl(jobId: string, filename?: string): string {
  const base = getApiBaseUrl();
  const name = filename || `CleanCut_${jobId}.mp4`;
  return `${base}/api/download/${jobId}?filename=${encodeURIComponent(name)}`;
}
