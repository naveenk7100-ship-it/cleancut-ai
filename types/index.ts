export interface HardwareInfo {
  device: "cpu" | "cuda" | "directml";
  device_name: string;
  cuda_available: boolean;
  threads: number;
}

export interface VideoMetadata {
  width: number;
  height: number;
  fps: number;
  total_frames: number;
  duration: number;
  has_audio: boolean;
  audio_codec: string;
  file_size: number;
  hardware: HardwareInfo;
}

export interface Keyframe {
  time: number; // in seconds
  x: number;
  y: number;
  width: number;
  height: number;
  is_normalized?: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface MaskPath {
  points: Point[];
  width: number;
  is_normalized?: boolean;
}

export interface MaskSpec {
  type: "rectangle" | "brush" | "keyframes" | "polygon" | "image";
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
    is_normalized?: boolean;
  };
  keyframes?: Keyframe[];
  paths?: MaskPath[];
  polygon?: Point[];
  imageBase64?: string;
}

export interface InpaintOptions {
  dilation: number; // 0 to 10
  feather: number; // 0 to 20
  method: "ns" | "telea";
  temporalWindow: number; // 0 to 5
}

export interface PreviewResponse {
  status: "success" | "error";
  frame_index: number;
  timestamp: number;
  width: number;
  height: number;
  inpaint_time_ms: number;
  mask_pixels_count: number;
  original_image: string;
  cleaned_image: string;
  mask_overlay_image: string;
  error?: string;
}

export interface JobProgress {
  jobId: string;
  stage: string;
  progress: number;
  frame: number;
  total_frames: number;
  fps?: number;
  eta_seconds?: number;
  elapsed_seconds?: number;
  status: "queued" | "processing" | "completed" | "failed";
  error?: string;
  output_video?: string;
  resultUrl?: string;
  inputUrl?: string;
  metadata?: VideoMetadata;
}
