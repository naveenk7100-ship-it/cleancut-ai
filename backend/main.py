#!/usr/bin/env python3
"""
CleanCut AI - FastAPI Production Backend
High-Performance Video Inpainting Service with SSE Streaming & Audio Preservation.
"""

import os
import sys
import time
import uuid
import json
import shutil
import asyncio
import threading
from typing import Dict, Any, Optional, List
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request, BackgroundTasks
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import core inpainting engine functions
from backend.inpaint_engine import (
    get_video_metadata,
    preview_frame_inpaint,
    process_video_inpainting,
    get_hardware_info,
    get_ffmpeg_path,
)

# App Configuration
BASE_DIR = Path(__file__).resolve().parent.parent
STORAGE_DIR = Path(os.environ.get("STORAGE_DIR", str(BASE_DIR / "storage")))
UPLOAD_DIR = STORAGE_DIR / "uploads"
OUTPUT_DIR = STORAGE_DIR / "outputs"
SAMPLES_DIR = BASE_DIR / "public" / "samples"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SAMPLES_DIR.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "500"))
MAX_CONCURRENT_JOBS = int(os.environ.get("MAX_CONCURRENT_JOBS", "2"))
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv", ".avi"}

app = FastAPI(
    title="CleanCut AI Inpainting API",
    description="Production-ready video watermark inpainting service using temporal reconstruction and OpenCV/FFmpeg.",
    version="1.0.0",
)

# CORS Configuration
allowed_origins_env = os.environ.get("ALLOWED_ORIGINS", "*")
if allowed_origins_env == "*":
    origins = ["*"]
else:
    origins = [o.strip() for o in allowed_origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-Memory Job Registry
class JobState:
    def __init__(self, job_id: str, input_path: str, video_url: str, metadata: Dict[str, Any]):
        self.job_id = job_id
        self.input_path = input_path
        self.output_path = str(OUTPUT_DIR / f"{job_id}_cleaned.mp4")
        self.video_url = video_url
        self.result_url = f"/api/download/{job_id}"
        self.metadata = metadata
        self.status = "queued"  # queued | processing | completed | failed
        self.stage = "Ready to process"
        self.progress = 0.0
        self.frame = 0
        self.total_frames = metadata.get("total_frames", 0)
        self.fps = 0.0
        self.eta_seconds = 0.0
        self.elapsed_seconds = 0.0
        self.error: Optional[str] = None
        self.subscribers: List[asyncio.Queue] = []
        self.lock = threading.Lock()
        self.created_at = time.time()

    def to_dict(self) -> Dict[str, Any]:
        with self.lock:
            return {
                "jobId": self.job_id,
                "status": self.status,
                "stage": self.stage,
                "progress": round(self.progress, 1),
                "frame": self.frame,
                "total_frames": self.total_frames,
                "fps": round(self.fps, 1),
                "eta_seconds": round(self.eta_seconds, 1),
                "elapsed_seconds": round(self.elapsed_seconds, 1),
                "error": self.error,
                "inputUrl": self.video_url,
                "resultUrl": self.result_url,
                "metadata": self.metadata,
            }

    def update(self, **kwargs):
        with self.lock:
            for k, v in kwargs.items():
                if hasattr(self, k):
                    setattr(self, k, v)
        # Notify subscribers
        data = self.to_dict()
        for q in list(self.subscribers):
            try:
                q.put_nowait(data)
            except Exception:
                pass


jobs: Dict[str, JobState] = {}
job_semaphore = threading.Semaphore(MAX_CONCURRENT_JOBS)


# Pydantic Request Models
class PreviewRequest(BaseModel):
    jobId: str
    timestamp: float = 0.0
    maskSpec: Any
    dilation: int = 4
    feather: int = 5
    method: str = "ns"
    temporalWindow: int = 2


class ProcessRequest(BaseModel):
    jobId: str
    maskSpec: Any
    dilation: int = 4
    feather: int = 5
    method: str = "ns"
    temporalWindow: int = 2


class SampleRequest(BaseModel):
    sampleId: str


# Sample presets metadata
SAMPLE_PRESETS = [
  {
    "id": "sample_landscape",
    "title": "16:9 Landscape Video (Fixed Watermark)",
    "description": "1280x720 video with animated geometry, camera motion, audio tone, and fixed watermark badge.",
    "fileName": "landscape_watermark_sample.mp4",
    "videoUrl": "/samples/landscape_watermark_sample.mp4",
    "defaultMask": {
      "type": "rectangle",
      "rect": {
        "x": 880,
        "y": 50,
        "width": 350,
        "height": 70,
        "is_normalized": False,
      },
    },
  },
  {
    "id": "sample_portrait",
    "title": "9:16 Portrait Video (Moving Watermark)",
    "description": "720x1280 vertical video with moving watermark across frames and full keyframe interpolation.",
    "fileName": "portrait_moving_watermark_sample.mp4",
    "videoUrl": "/samples/portrait_moving_watermark_sample.mp4",
    "defaultMask": {
      "type": "keyframes",
      "keyframes": [
        {"time": 0.0, "x": 50, "y": 150, "width": 260, "height": 60, "is_normalized": False},
        {"time": 4.0, "x": 360, "y": 800, "width": 260, "height": 60, "is_normalized": False},
      ],
    },
  },
]


@app.get("/health")
async def health_check():
    """Health check endpoint providing runtime & hardware status."""
    return {
        "status": "ok",
        "service": "cleancut-ai-backend",
        "version": "1.0.0",
        "hardware": get_hardware_info(),
        "ffmpeg": get_ffmpeg_path(),
        "active_jobs": len([j for j in jobs.values() if j.status == "processing"]),
        "timestamp": time.time(),
    }


@app.get("/api/samples")
async def get_samples():
    """Return list of sample videos for instant demo testing."""
    return {"samples": SAMPLE_PRESETS}


@app.post("/api/samples")
async def load_sample(req: SampleRequest):
    """Load a sample video as an active job."""
    preset = next((s for s in SAMPLE_PRESETS if s["id"] == req.sampleId), None)
    if not preset:
        raise HTTPException(status_code=404, detail="Sample preset not found")

    sample_file = SAMPLES_DIR / preset["fileName"]
    if not sample_file.is_file():
        # Generate sample on the fly if missing
        try:
            from backend.generate_samples import main as gen_samples
            gen_samples()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to generate sample: {e}")

    job_id = f"sample_{uuid.uuid4().hex[:8]}"
    metadata = get_video_metadata(str(sample_file))

    # In local/container, serve sample file URL
    job_state = JobState(
        job_id=job_id,
        input_path=str(sample_file),
        video_url=preset["videoUrl"],
        metadata=metadata,
    )
    jobs[job_id] = job_state

    return {
        "success": True,
        "jobId": job_id,
        "videoUrl": preset["videoUrl"],
        "fileName": preset["fileName"],
        "metadata": metadata,
        "defaultMask": preset["defaultMask"],
        "job": job_state.to_dict(),
    }


@app.post("/api/upload")
async def upload_video(file: UploadFile = File(...)):
    """Upload and validate video file."""
    filename = file.filename or "video.mp4"
    ext = Path(filename).suffix.lower()

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format '{ext}'. Allowed formats: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    job_id = f"cc_{uuid.uuid4().hex[:10]}"
    dest_path = UPLOAD_DIR / f"{job_id}_input{ext}"

    # Read and validate size limit
    total_size = 0
    max_bytes = MAX_UPLOAD_MB * 1024 * 1024

    with open(dest_path, "wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            total_size += len(chunk)
            if total_size > max_bytes:
                dest_path.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=400,
                    detail=f"File exceeds maximum allowed size of {MAX_UPLOAD_MB}MB",
                )
            f.write(chunk)

    try:
        metadata = get_video_metadata(str(dest_path))
        video_url = f"/api/raw/{job_id}"

        job_state = JobState(
            job_id=job_id,
            input_path=str(dest_path),
            video_url=video_url,
            metadata=metadata,
        )
        jobs[job_id] = job_state

        return {
            "success": True,
            "jobId": job_id,
            "videoUrl": video_url,
            "fileName": filename,
            "metadata": metadata,
            "job": job_state.to_dict(),
        }
    except Exception as e:
        dest_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=f"Invalid video file: {str(e)}")


@app.get("/api/raw/{job_id}")
async def get_raw_input_video(job_id: str):
    """Serve uploaded input video file."""
    job = jobs.get(job_id)
    if not job or not os.path.isfile(job.input_path):
        raise HTTPException(status_code=404, detail="Video file not found")
    return FileResponse(job.input_path, media_type="video/mp4")


@app.post("/api/preview-frame")
async def preview_frame(req: PreviewRequest):
    """Instant single-frame inpainting preview for verification."""
    job = jobs.get(req.jobId)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    try:
        result = preview_frame_inpaint(
            video_path=job.input_path,
            timestamp=req.timestamp,
            mask_spec=req.maskSpec,
            dilation=req.dilation,
            feather=req.feather,
            method=req.method,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Preview generation failed: {str(e)}")


def run_inpainting_thread(job_state: JobState, mask_spec: Any, dilation: int, feather: int, method: str, temporal_window: int):
    """Background worker executing full video temporal reconstruction."""
    with job_semaphore:
        job_state.update(status="processing", stage="Starting inpainting engine...", progress=1.0)

        def progress_cb(update: Dict[str, Any]):
            job_state.update(
                progress=update.get("progress", job_state.progress),
                stage=update.get("stage", job_state.stage),
                frame=update.get("frame", job_state.frame),
                total_frames=update.get("total_frames", job_state.total_frames),
                fps=update.get("fps", job_state.fps),
                eta_seconds=update.get("eta_seconds", job_state.eta_seconds),
                elapsed_seconds=update.get("elapsed_seconds", job_state.elapsed_seconds),
            )

        try:
            res = process_video_inpainting(
                input_video=job_state.input_path,
                output_video=job_state.output_path,
                mask_spec=mask_spec,
                dilation=dilation,
                feather=feather,
                method=method,
                temporal_window=temporal_window,
                progress_callback=progress_cb,
            )
            job_state.update(
                status="completed",
                progress=100.0,
                stage="Complete",
                elapsed_seconds=res.get("elapsed_seconds", 0.0),
            )
        except Exception as e:
            job_state.update(status="failed", error=str(e), stage=f"Error: {str(e)}")


@app.post("/api/process")
async def start_process(req: ProcessRequest, background_tasks: BackgroundTasks):
    """Initiate complete video inpainting pipeline."""
    job = jobs.get(req.jobId)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status == "processing":
        raise HTTPException(status_code=409, detail="Job is already processing")

    # Start background inpaint worker thread
    worker_thread = threading.Thread(
        target=run_inpainting_thread,
        args=(job, req.maskSpec, req.dilation, req.feather, req.method, req.temporalWindow),
        daemon=True,
    )
    worker_thread.start()

    return {
        "success": True,
        "jobId": req.jobId,
        "status": "processing",
        "message": "Video inpainting started",
    }


@app.get("/api/job/{job_id}")
async def get_job_status(job_id: str, request: Request):
    """Query job status via JSON polling or SSE stream."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    accept = request.headers.get("accept", "")
    if "text/event-stream" in accept:
        async def event_generator():
            q = asyncio.Queue()
            job.subscribers.append(q)
            # Send initial state
            yield f"data: {json.dumps(job.to_dict())}\n\n"

            try:
                while True:
                    if job.status in ("completed", "failed"):
                        yield f"data: {json.dumps(job.to_dict())}\n\n"
                        break
                    try:
                        data = await asyncio.wait_for(q.get(), timeout=20.0)
                        yield f"data: {json.dumps(data)}\n\n"
                        if data.get("status") in ("completed", "failed"):
                            break
                    except asyncio.TimeoutError:
                        # Heartbeat ping
                        yield f": ping\n\n"
            finally:
                if q in job.subscribers:
                    job.subscribers.remove(q)

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    return job.to_dict()


@app.get("/api/download/{job_id}")
async def download_cleaned_video(job_id: str, filename: Optional[str] = None):
    """Download the reconstructed MP4 video."""
    job = jobs.get(job_id)
    out_file = OUTPUT_DIR / f"{job_id}_cleaned.mp4"

    if not out_file.is_file():
        raise HTTPException(status_code=404, detail="Cleaned video not found or still processing")

    dl_name = filename or f"CleanCut_{job_id}.mp4"
    if not dl_name.endswith(".mp4"):
        dl_name += ".mp4"

    return FileResponse(
        str(out_file),
        media_type="video/mp4",
        filename=dl_name,
        headers={"Cache-Control": "public, max-age=3600"},
    )


# Periodic cleanup of expired temporary files (> 2 hours old)
def cleanup_old_storage():
    max_age_sec = 2 * 3600
    now = time.time()
    for directory in [UPLOAD_DIR, OUTPUT_DIR]:
        if not directory.exists():
            continue
        for p in directory.iterdir():
            try:
                if p.is_file() and (now - p.stat().st_mtime > max_age_sec):
                    p.unlink(missing_ok=True)
            except Exception:
                pass


def background_cleanup_loop():
    while True:
        time.sleep(1800)  # Every 30 mins
        cleanup_old_storage()


cleanup_thread = threading.Thread(target=background_cleanup_loop, daemon=True)
cleanup_thread.start()


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=False)
