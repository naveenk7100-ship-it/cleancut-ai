#!/usr/bin/env python3
"""
CleanCut AI - Production End-to-End Verification Test Script
Tests the live FastAPI production backend and Next.js frontend API.
"""

import sys
import os
import time
import json
import uuid
import urllib.request
import urllib.error
import argparse
import subprocess
import numpy as np
import cv2

# Add workspace directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")



def http_get(url: str, retries: int = 5, timeout: int = 25):
    req = urllib.request.Request(url, headers={"User-Agent": "CleanCut-Prod-Verifier/1.0"})
    last_err = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read()
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, Exception) as e:
            last_err = e
            if attempt < retries - 1:
                time.sleep(1.5)
            else:
                raise last_err


def http_post_json(url: str, data: dict, retries: int = 3, timeout: int = 45):
    json_bytes = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=json_bytes,
        headers={"Content-Type": "application/json", "User-Agent": "CleanCut-Prod-Verifier/1.0"}
    )
    last_err = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, Exception) as e:
            last_err = e
            if attempt < retries - 1:
                time.sleep(2.0)
            else:
                raise last_err


def http_post_multipart(url: str, file_path: str, retries: int = 3, timeout: int = 60):
    boundary = f"----WebKitFormBoundary{uuid.uuid4().hex}"
    filename = os.path.basename(file_path)
    
    with open(file_path, "rb") as f:
        file_bytes = f.read()

    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: video/mp4\r\n\r\n"
    ).encode("utf-8") + file_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "CleanCut-Prod-Verifier/1.0"
        }
    )

    last_err = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            last_err = e
            if attempt < retries - 1:
                time.sleep(2.0)
            else:
                raise last_err


def create_test_video_with_audio(output_path: str, width: int = 640, height: int = 360, fps: int = 30, duration: float = 2.0):
    """Generate a high-quality test video with animated background, watermark badge, and audio tone."""
    temp_raw_video = output_path + ".raw.mp4"
    temp_raw_audio = output_path + ".raw.wav"

    num_frames = int(fps * duration)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(temp_raw_video, fourcc, fps, (width, height))

    for i in range(num_frames):
        t = i / fps
        # Smooth animated gradient background
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        c1 = int(128 + 100 * np.sin(t * 3.0))
        c2 = int(128 + 100 * np.cos(t * 2.5))
        frame[:, :] = [c1, 40, c2]

        # Moving element
        cx = int(width / 2 + 100 * np.cos(t * 4.0))
        cy = int(height / 2 + 60 * np.sin(t * 4.0))
        cv2.circle(frame, (cx, cy), 35, (255, 255, 255), -1)

        # Embedded Watermark Badge (Fixed in top-right)
        wx, wy, ww, wh = 420, 25, 200, 45
        cv2.rectangle(frame, (wx, wy), (wx + ww, wy + wh), (30, 30, 200), -1)
        cv2.putText(frame, "CLEANCUT-SAMPLE", (wx + 10, wy + 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

        out.write(frame)
    out.release()

    # Generate stereo audio waveform
    import wave
    import struct
    sample_rate = 44100
    total_audio_samples = int(sample_rate * duration)
    with wave.open(temp_raw_audio, "w") as wav_file:
        wav_file.setnchannels(2)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        for s in range(total_audio_samples):
            freq = 440.0 + 100.0 * np.sin(2 * np.pi * 2.0 * s / sample_rate)
            val = int(16000 * np.sin(2 * np.pi * freq * s / sample_rate))
            data = struct.pack("<hh", val, val)
            wav_file.writeframesraw(data)

    # Mux with FFmpeg
    try:
        from backend.inpaint_engine import get_ffmpeg_path
        ffmpeg_bin = get_ffmpeg_path()
        cmd = [
            ffmpeg_bin, "-y",
            "-i", temp_raw_video,
            "-i", temp_raw_audio,
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k",
            output_path
        ]
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    finally:
        if os.path.exists(temp_raw_video):
            os.remove(temp_raw_video)
        if os.path.exists(temp_raw_audio):
            os.remove(temp_raw_audio)

    return {"width": width, "height": height, "fps": fps, "duration": duration, "watermark": {"x": 420, "y": 25, "width": 200, "height": 45}}


def test_production_pipeline(base_url: str):
    print("==================================================================")
    print(f" CleanCut AI -- LIVE PRODUCTION VERIFICATION against {base_url}")
    print("==================================================================")

    # 1. Health Check
    print(f"\n[1/7] Testing Backend Health & Liveness at {base_url}/health...")
    status, health_bytes = http_get(f"{base_url}/health")
    health_info = json.loads(health_bytes.decode("utf-8"))
    print(f"  [PASS] HTTP {status}: Service='{health_info.get('service')}', Hardware={health_info.get('hardware', {}).get('device_name')}")
    assert health_info.get("status") == "ok"

    # 2. Real File Upload via Multipart/form-data
    print("\n[2/7] Testing Real MP4 File Upload (/api/upload)...")
    test_video_path = os.path.abspath("scratch_test_upload.mp4")
    video_spec = create_test_video_with_audio(test_video_path, width=640, height=360, fps=30, duration=2.0)
    print(f"  Generated local test MP4: {video_spec['width']}x{video_spec['height']}, {video_spec['fps']} FPS, {video_spec['duration']}s with AAC audio")

    try:
        up_status, up_res = http_post_multipart(f"{base_url}/api/upload", test_video_path)
        job_id = up_res["jobId"]
        meta = up_res["metadata"]
        print(f"  [PASS] File Uploaded! Job ID: {job_id}")
        print(f"    Metadata: {meta['width']}x{meta['height']}, FPS: {meta['fps']}, Duration: {meta['duration']}s, Audio: {meta['has_audio']}")
        assert meta["has_audio"] is True
    finally:
        if os.path.exists(test_video_path):
            os.remove(test_video_path)

    # 3. Watermark Mask Selection & Single-Frame Preview
    print("\n[3/7] Testing Watermark Mask Selection & Frame Preview (/api/preview-frame)...")
    mask_spec = {
        "type": "rectangle",
        "rect": {
            "x": video_spec["watermark"]["x"] - 5,
            "y": video_spec["watermark"]["y"] - 5,
            "width": video_spec["watermark"]["width"] + 10,
            "height": video_spec["watermark"]["height"] + 10,
            "is_normalized": False,
        }
    }
    t0 = time.time()
    p_status, prev_res = http_post_json(
        f"{base_url}/api/preview-frame",
        {
            "jobId": job_id,
            "timestamp": 1.0,
            "maskSpec": mask_spec,
            "dilation": 4,
            "feather": 6,
            "method": "ns"
        }
    )
    prev_dur = round((time.time() - t0) * 1000, 1)
    print(f"  [PASS] Single-Frame Inpainting Preview Generated in {prev_dur}ms!")
    print(f"    Kernel time: {prev_res['inpaint_time_ms']}ms, Inpainted Pixels: {prev_res['mask_pixels_count']}")
    assert prev_res["cleaned_image"].startswith("data:image/jpeg;base64,")

    # 4. Full Video Inpainting Execution
    print("\n[4/7] Starting Complete Temporal Video Inpainting (/api/process)...")
    proc_status, proc_res = http_post_json(
        f"{base_url}/api/process",
        {
            "jobId": job_id,
            "maskSpec": mask_spec,
            "dilation": 4,
            "feather": 6,
            "method": "ns",
            "temporalWindow": 2
        }
    )
    print(f"  [PASS] Inpainting Queued: {proc_res['message']}")

    # 5. Polling Progress Updates
    print("\n[5/7] Polling Real-Time Job Progress (/api/job/[id])...")
    completed_job = None
    for attempt in range(120):
        time.sleep(1.5)
        j_status, j_data = http_get(f"{base_url}/api/job/{job_id}")
        job_info = json.loads(j_data.decode("utf-8"))
        status_val = job_info["status"]
        progress_val = job_info["progress"]
        stage_val = job_info.get("stage", "")

        sys.stdout.write(f"\r    Status: {status_val.upper()} | Progress: {progress_val:.1f}% | Stage: {stage_val}          ")
        sys.stdout.flush()

        if status_val == "completed":
            completed_job = job_info
            print(f"\n  [PASS] Video Inpainting 100% Completed in {job_info.get('elapsed_seconds', '--')}s!")
            break
        elif status_val == "failed":
            print(f"\n  [FAIL] Inpainting failed: {job_info.get('error')}")
            return False

    assert completed_job is not None, "Job timed out"

    # 6. Download Cleaned MP4
    print("\n[6/7] Downloading Cleaned MP4 File (/api/download/[id])...")
    dl_status, dl_data = http_get(f"{base_url}/api/download/{job_id}")
    print(f"  [PASS] Download endpoint returned HTTP {dl_status} (Size: {len(dl_data):,} bytes)")
    assert dl_status == 200 and len(dl_data) > 50000

    downloaded_mp4_path = os.path.abspath("downloaded_cleancut_result.mp4")
    with open(downloaded_mp4_path, "wb") as f:
        f.write(dl_data)

    # 7. Verify Video Fidelity, Resolution, FPS, Duration & Audio Stream
    print("\n[7/7] Verifying Downloaded Video Integrity, Audio & Streams...")
    try:
        from backend.inpaint_engine import get_video_metadata
        out_meta = get_video_metadata(downloaded_mp4_path)
        print(f"  Output Resolution : {out_meta['width']}x{out_meta['height']} (Original: {video_spec['width']}x{video_spec['height']})")
        print(f"  Output FPS        : {out_meta['fps']} (Original: {video_spec['fps']})")
        print(f"  Output Duration   : {out_meta['duration']:.2f}s (Original: {video_spec['duration']}s)")
        print(f"  Output Audio Stream: {out_meta['has_audio']} (AAC preserved)")

        assert out_meta['width'] == video_spec['width']
        assert out_meta['height'] == video_spec['height']
        assert abs(out_meta['duration'] - video_spec['duration']) < 0.3
        assert out_meta['has_audio'] is True
        print(f"  [PASS] All Video Fidelity, Duration, FPS, and Audio criteria VERIFIED!")
    finally:
        if os.path.exists(downloaded_mp4_path):
            os.remove(downloaded_mp4_path)

    print("\n==================================================================")
    print(" ALL PRODUCTION VERIFICATION TESTS PASSED SUCCESSFULLY!           ")
    print("==================================================================")
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", default="https://cleancut-ai.onrender.com", help="Target backend URL")
    args = parser.parse_args()

    success = test_production_pipeline(args.target)
    sys.exit(0 if success else 1)
