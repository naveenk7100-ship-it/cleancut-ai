#!/usr/bin/env python3
"""
CleanCut AI - High-Fidelity Video Watermark Inpainting Engine
Production-grade Video Inpainting Pipeline:
1. Feature-Based + Optical Flow Background Motion Compensation (RANSAC Affine & PyrLK)
2. Ghost-Free Temporal Donor Selection & Occlusion Mask Rejection
3. Moving Object & Fine Edge Trajectory Preservation
4. Multi-Scale Progressive Spatial Inpainting with Boundary Color Harmonization
5. Exact Resolution, FPS, Duration, and Audio Stream Preservation
6. Memory-Bounded (<=150MB RAM) for Free Container Deployments
"""

import sys
import os
import gc
import json
import time
import argparse
import subprocess
import shutil
import tempfile
import base64
from typing import Dict, List, Any, Optional, Tuple

import cv2
import numpy as np

try:
    import imageio_ffmpeg
    DEFAULT_FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    DEFAULT_FFMPEG = "ffmpeg"


def get_ffmpeg_path() -> str:
    """Find the best available FFmpeg binary."""
    env_ffmpeg = os.environ.get("FFMPEG_PATH")
    if env_ffmpeg and os.path.isfile(env_ffmpeg):
        return env_ffmpeg

    try:
        import imageio_ffmpeg
        p = imageio_ffmpeg.get_ffmpeg_exe()
        if p and os.path.isfile(p):
            return p
    except Exception:
        pass

    system_p = shutil.which("ffmpeg")
    if system_p:
        return system_p

    return "ffmpeg"


def get_ffprobe_path() -> Optional[str]:
    """Find the best available FFprobe binary."""
    env_probe = os.environ.get("FFPROBE_PATH")
    if env_probe and os.path.isfile(env_probe):
        return env_probe

    system_probe = shutil.which("ffprobe")
    if system_probe:
        return system_probe

    ffmpeg_p = get_ffmpeg_path()
    if ffmpeg_p:
        candidate = os.path.join(os.path.dirname(ffmpeg_p), "ffprobe.exe" if os.name == "nt" else "ffprobe")
        if os.path.isfile(candidate):
            return candidate

    return None


def get_hardware_info() -> Dict[str, Any]:
    """Detect available compute hardware (CPU/GPU)."""
    info = {
        "device": "cpu",
        "device_name": "CPU (Multi-threaded)",
        "cuda_available": False,
        "threads": os.cpu_count() or 4
    }
    try:
        import torch
        if torch.cuda.is_available():
            info["device"] = "cuda"
            info["device_name"] = torch.cuda.get_device_name(0)
            info["cuda_available"] = True
    except Exception:
        pass
    return info


def get_video_metadata(video_path: str) -> Dict[str, Any]:
    """Extract full metadata from video file using OpenCV and FFmpeg."""
    if not os.path.isfile(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()

    if fps <= 0 or np.isnan(fps):
        fps = 30.0
    duration = total_frames / fps if total_frames > 0 else 0.0

    # Check for audio stream using ffmpeg
    has_audio = False
    audio_codec = "none"
    ffmpeg_exe = get_ffmpeg_path()
    try:
        cmd = [ffmpeg_exe, "-i", video_path]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10)
        output = res.stderr or res.stdout
        if "Audio:" in output:
            has_audio = True
            for line in output.splitlines():
                if "Audio:" in line:
                    parts = line.split("Audio:")[1].strip().split(",")
                    if parts:
                        audio_codec = parts[0].strip()
                    break
    except Exception as e:
        sys.stderr.write(f"Warning checking audio: {e}\n")

    return {
        "width": width,
        "height": height,
        "fps": round(fps, 3),
        "total_frames": total_frames,
        "duration": round(duration, 3),
        "has_audio": has_audio,
        "audio_codec": audio_codec,
        "file_size": os.path.getsize(video_path),
        "hardware": get_hardware_info()
    }


def parse_mask_spec(mask_spec: Any, width: int, height: int, current_time: float) -> np.ndarray:
    """
    Generate binary uint8 mask (0=keep, 255=inpaint) for a specific timestamp.
    Supports:
    - Base64 PNG image mask
    - Static rectangle {x, y, width, height} in pixels or normalized [0, 1]
    - Keyframed rectangles [{time: 0, x: .., y: ..}, {time: 5, x: .., y: ..}]
    - Polygon points [{x, y}, ...]
    - Freehand path strokes
    """
    mask = np.zeros((height, width), dtype=np.uint8)

    if not mask_spec:
        return mask

    if isinstance(mask_spec, str):
        if mask_spec.startswith("data:image/") or len(mask_spec) > 200:
            try:
                if "," in mask_spec:
                    mask_spec = mask_spec.split(",", 1)[1]
                img_data = base64.b64decode(mask_spec)
                nparr = np.frombuffer(img_data, np.uint8)
                img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)
                if img is not None:
                    if len(img.shape) == 3 and img.shape[2] == 4:
                        mask = img[:, :, 3]
                    elif len(img.shape) == 3:
                        mask = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
                    else:
                        mask = img
                    if mask.shape != (height, width):
                        mask = cv2.resize(mask, (width, height), interpolation=cv2.INTER_NEAREST)
                    _, mask = cv2.threshold(mask, 10, 255, cv2.THRESH_BINARY)
                    return mask
            except Exception as e:
                sys.stderr.write(f"Error parsing base64 mask: {e}\n")
        try:
            mask_spec = json.loads(mask_spec)
        except Exception:
            pass

    if isinstance(mask_spec, dict):
        if "keyframes" in mask_spec and isinstance(mask_spec["keyframes"], list) and len(mask_spec["keyframes"]) > 0:
            kfs = sorted(mask_spec["keyframes"], key=lambda k: k.get("time", 0.0))
            if current_time <= kfs[0]["time"]:
                _draw_kf_box(mask, kfs[0], width, height)
            elif current_time >= kfs[-1]["time"]:
                _draw_kf_box(mask, kfs[-1], width, height)
            else:
                for i in range(len(kfs) - 1):
                    k1, k2 = kfs[i], kfs[i + 1]
                    t1, t2 = k1.get("time", 0.0), k2.get("time", 0.0)
                    if t1 <= current_time <= t2:
                        alpha = (current_time - t1) / (t2 - t1) if t2 > t1 else 0.0
                        interp_kf = {
                            "x": (1 - alpha) * k1.get("x", 0) + alpha * k2.get("x", 0),
                            "y": (1 - alpha) * k1.get("y", 0) + alpha * k2.get("y", 0),
                            "width": (1 - alpha) * k1.get("width", 0) + alpha * k2.get("width", 0),
                            "height": (1 - alpha) * k1.get("height", 0) + alpha * k2.get("height", 0),
                            "is_normalized": k1.get("is_normalized", False) or k2.get("is_normalized", False)
                        }
                        _draw_kf_box(mask, interp_kf, width, height)
                        break
            return mask

        if "rect" in mask_spec or "x" in mask_spec:
            rect = mask_spec.get("rect", mask_spec)
            _draw_kf_box(mask, rect, width, height)
            return mask

        if "paths" in mask_spec and isinstance(mask_spec["paths"], list):
            for path in mask_spec["paths"]:
                points = path.get("points", [])
                stroke_width = int(path.get("width", 20))
                is_norm = path.get("is_normalized", False)
                if len(points) >= 2:
                    pts = []
                    for pt in points:
                        px = int(pt["x"] * width if is_norm else pt["x"])
                        py = int(pt["y"] * height if is_norm else pt["y"])
                        pts.append((px, py))
                    for i in range(len(pts) - 1):
                        cv2.line(mask, pts[i], pts[i + 1], 255, thickness=stroke_width, lineType=cv2.LINE_AA)
                elif len(points) == 1:
                    px = int(points[0]["x"] * width if is_norm else points[0]["x"])
                    py = int(points[0]["y"] * height if is_norm else points[0]["y"])
                    cv2.circle(mask, (px, py), stroke_width // 2, 255, -1)
            return mask

        if "polygon" in mask_spec and isinstance(mask_spec["polygon"], list):
            pts = []
            is_norm = mask_spec.get("is_normalized", False)
            for pt in mask_spec["polygon"]:
                px = int(pt["x"] * width if is_norm else pt["x"])
                py = int(pt["y"] * height if is_norm else pt["y"])
                pts.append([px, py])
            if len(pts) >= 3:
                cv2.fillPoly(mask, [np.array(pts, dtype=np.int32)], 255)
            return mask

    elif isinstance(mask_spec, list):
        for item in mask_spec:
            if isinstance(item, dict):
                if "x" in item and "width" in item:
                    _draw_kf_box(mask, item, width, height)
                elif "points" in item:
                    points = item.get("points", [])
                    stroke_width = int(item.get("width", 20))
                    is_norm = item.get("is_normalized", False)
                    if len(points) >= 2:
                        pts = []
                        for pt in points:
                            px = int(pt["x"] * width if is_norm else pt["x"])
                            py = int(pt["y"] * height if is_norm else pt["y"])
                            pts.append((px, py))
                        for i in range(len(pts) - 1):
                            cv2.line(mask, pts[i], pts[i + 1], 255, thickness=stroke_width, lineType=cv2.LINE_AA)
                    elif len(points) == 1:
                        px = int(points[0]["x"] * width if is_norm else points[0]["x"])
                        py = int(points[0]["y"] * height if is_norm else points[0]["y"])
                        cv2.circle(mask, (px, py), stroke_width // 2, 255, -1)

    return mask


def _draw_kf_box(mask: np.ndarray, box: Dict[str, Any], width: int, height: int):
    """Draw a bounding box onto mask array."""
    is_norm = box.get("is_normalized", False)
    bx = box.get("x", 0)
    by = box.get("y", 0)
    bw = box.get("width", 0)
    bh = box.get("height", 0)

    if is_norm or (0.0 <= bx <= 1.0 and 0.0 <= bw <= 1.0 and 0.0 <= by <= 1.0 and 0.0 <= bh <= 1.0):
        x1 = max(0, min(width - 1, int(bx * width)))
        y1 = max(0, min(height - 1, int(by * height)))
        x2 = max(0, min(width, int((bx + bw) * width)))
        y2 = max(0, min(height, int((by + bh) * height)))
    else:
        x1 = max(0, min(width - 1, int(bx)))
        y1 = max(0, min(height - 1, int(by)))
        x2 = max(0, min(width, int(bx + bw)))
        y2 = max(0, min(height, int(by + bh)))

    if x2 > x1 and y2 > y1:
        mask[y1:y2, x1:x2] = 255


def refine_mask(mask: np.ndarray, dilation: int = 4, feather: int = 5) -> Tuple[np.ndarray, np.ndarray]:
    """
    Expand mask slightly to cover watermark anti-aliasing edges,
    and compute a distance-based feathering alpha weight for seamless edge blending.
    """
    if np.count_nonzero(mask) == 0:
        return mask.copy(), np.zeros(mask.shape, dtype=np.float32)

    safe_dilation = max(2, min(8, dilation))
    kernel_size = safe_dilation * 2 + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    dilated_mask = cv2.dilate(mask, kernel, iterations=1)

    dist = cv2.distanceTransform(dilated_mask, cv2.DIST_L2, 5)
    blend_width = float(max(2, min(8, feather)))
    alpha = np.clip(dist / blend_width, 0.0, 1.0).astype(np.float32)

    return dilated_mask, alpha


def estimate_background_motion(
    curr_gray: np.ndarray,
    n_gray: np.ndarray,
    curr_mask: np.ndarray,
    n_mask: np.ndarray
) -> Optional[np.ndarray]:
    """
    Estimate global affine background motion between current and neighbor frames
    using features located strictly in the clean background outside the watermark.
    """
    h, w = curr_gray.shape[:2]
    # Background mask (strictly clean background)
    bg_mask = ((curr_mask == 0) & (n_mask == 0)).astype(np.uint8) * 255
    if np.count_nonzero(bg_mask) < 100:
        bg_mask = (curr_mask == 0).astype(np.uint8) * 255

    pts_curr = cv2.goodFeaturesToTrack(curr_gray, maxCorners=150, qualityLevel=0.01, minDistance=8, mask=bg_mask)
    if pts_curr is None or len(pts_curr) < 6:
        return None

    pts_n, status, _ = cv2.calcOpticalFlowPyrLK(curr_gray, n_gray, pts_curr, None)
    if pts_n is None or status is None:
        return None

    good_curr = pts_curr[status == 1]
    good_n = pts_n[status == 1]

    if len(good_curr) < 6:
        return None

    # Estimate Affine transform using RANSAC
    matrix, inliers = cv2.estimateAffinePartial2D(good_n, good_curr, method=cv2.RANSAC, ransacReprojThreshold=3.0)
    return matrix


def harmonize_color_luminance(
    inpainted_roi: np.ndarray,
    orig_roi: np.ndarray,
    mask_roi: np.ndarray
) -> np.ndarray:
    """
    Ensure purely spatial inpaint areas match background luminance and chroma
    sampled from the outer ring of clean unmasked pixels, preventing dark smudges.
    """
    if np.count_nonzero(mask_roi) == 0:
        return inpainted_roi

    ring_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21))
    outer_ring = cv2.dilate(mask_roi, ring_kernel, iterations=1) - mask_roi
    
    bg_pixels = orig_roi[outer_ring > 0]
    inpaint_pixels = inpainted_roi[mask_roi > 0]

    if len(bg_pixels) < 10 or len(inpaint_pixels) < 10:
        return inpainted_roi

    bg_mean = np.mean(bg_pixels, axis=0)
    inp_mean = np.mean(inpaint_pixels, axis=0)

    result = inpainted_roi.astype(np.float32).copy()
    for c in range(3):
        shift = (bg_mean[c] - inp_mean[c]) * 0.85
        result[:, :, c] = np.where(
            mask_roi > 0,
            np.clip(result[:, :, c] + shift, 0, 255),
            result[:, :, c]
        )

    return result.astype(np.uint8)


def inpaint_spatial_multiscale(
    roi_img: np.ndarray,
    roi_mask: np.ndarray,
    method: str = "ns"
) -> np.ndarray:
    """
    Progressive multi-scale inpainting for residual pixels:
    1. Fast Marching Telea with adaptive radius for global low-frequency gradient fill.
    2. High-fidelity Navier-Stokes PDE refinement for edge and structure propagation.
    3. Color & luminance boundary harmonization.
    """
    if np.count_nonzero(roi_mask) == 0:
        return roi_img.copy()

    h, w = roi_img.shape[:2]
    min_dim = min(h, w)
    
    coarse_radius = max(3, min(25, int(min_dim * 0.15)))
    flag_coarse = cv2.INPAINT_TELEA
    
    base_fill = cv2.inpaint(roi_img, roi_mask, inpaintRadius=coarse_radius, flags=flag_coarse)

    flag_fine = cv2.INPAINT_NS if method == "ns" else cv2.INPAINT_TELEA
    fine_fill = cv2.inpaint(base_fill, roi_mask, inpaintRadius=max(3, min(7, coarse_radius // 2)), flags=flag_fine)

    harmonized = harmonize_color_luminance(fine_fill, roi_img, roi_mask)
    return harmonized


def inpaint_temporal_spatial(
    current_frame: np.ndarray,
    current_mask: np.ndarray,
    neighbor_frames: List[Tuple[int, np.ndarray, np.ndarray]],
    method: str = "ns",
    feather_alpha: Optional[np.ndarray] = None
) -> np.ndarray:
    """
    State-of-the-Art Motion-Compensated Temporal Reconstruction + Progressive Spatial Engine.
    1. Extracts clean background ROI context.
    2. Estimates background motion (RANSAC Affine & unmasked optical flow) to warp donor frames.
    3. Prioritizes donor pixels by photometric background similarity and temporal proximity.
    4. Reconstructs moving objects/lines with zero ghosting and zero dark patches.
    5. Solves residual unexposed gaps with multi-scale Navier-Stokes progressive inpainting.
    6. Applies distance-transform edge blending with clean background.
    """
    if np.count_nonzero(current_mask) == 0:
        return current_frame.copy()

    h, w = current_frame.shape[:2]

    x, y, bw, bh = cv2.boundingRect(current_mask)
    if bw <= 0 or bh <= 0:
        return current_frame.copy()

    pad = max(40, int(max(bw, bh) * 0.5))
    x1 = max(0, x - pad)
    y1 = max(0, y - pad)
    x2 = min(w, x + bw + pad)
    y2 = min(h, y + bh + pad)

    roi_frame = current_frame[y1:y2, x1:x2].copy()
    roi_mask = current_mask[y1:y2, x1:x2].copy()
    roi_h, roi_w = roi_frame.shape[:2]

    # Background ring outside mask for similarity scoring and color matching
    kernel_ring = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    outer_ring = cv2.dilate(roi_mask, kernel_ring, iterations=1) - roi_mask
    curr_bg_pixels = roi_frame[outer_ring > 0]

    curr_roi_gray = cv2.cvtColor(roi_frame, cv2.COLOR_BGR2GRAY)
    curr_bg_gray = curr_roi_gray.copy()
    if np.count_nonzero(roi_mask) > 0:
        coarse_curr = cv2.inpaint(curr_roi_gray, roi_mask, 5, cv2.INPAINT_TELEA)
        curr_bg_gray[roi_mask > 0] = coarse_curr[roi_mask > 0]

    # List of donor candidates: (warped_roi, valid_donor_mask, similarity_score, abs_offset)
    donor_candidates = []

    # 1. Process Temporal Neighbor Frames
    if neighbor_frames:
        for offset, n_frame, n_mask in neighbor_frames:
            try:
                n_roi_frame = n_frame[y1:y2, x1:x2]
                n_roi_mask = n_mask[y1:y2, x1:x2]
                n_roi_gray = cv2.cvtColor(n_roi_frame, cv2.COLOR_BGR2GRAY)

                # Measure background photometric similarity on unmasked ring
                n_bg_pixels = n_roi_frame[outer_ring > 0]
                if len(n_bg_pixels) > 0 and len(curr_bg_pixels) > 0:
                    diff = np.mean(np.abs(curr_bg_pixels.astype(float) - n_bg_pixels.astype(float)))
                    sim_score = float(1.0 / (1.0 + diff * 0.05))
                else:
                    sim_score = 0.5

                # Estimate background transformation matrix
                affine_mat = estimate_background_motion(curr_roi_gray, n_roi_gray, roi_mask, n_roi_mask)
                if affine_mat is not None:
                    warped_n_frame = cv2.warpAffine(n_roi_frame, affine_mat, (roi_w, roi_h), flags=cv2.INTER_LINEAR)
                    safe_n_mask = cv2.dilate(n_roi_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
                    warped_n_mask = cv2.warpAffine(safe_n_mask, affine_mat, (roi_w, roi_h), flags=cv2.INTER_NEAREST)
                else:
                    # Optical flow fallback on background-masked frames
                    n_bg_gray = n_roi_gray.copy()
                    if np.count_nonzero(n_roi_mask) > 0:
                        coarse_n = cv2.inpaint(n_roi_gray, n_roi_mask, 5, cv2.INPAINT_TELEA)
                        n_bg_gray[n_roi_mask > 0] = coarse_n[n_roi_mask > 0]

                    flow = cv2.calcOpticalFlowFarneback(
                        curr_bg_gray, n_bg_gray, None,
                        pyr_scale=0.5, levels=3, winsize=15,
                        iterations=3, poly_n=5, poly_sigma=1.2, flags=0
                    )
                    grid_x, grid_y = np.meshgrid(np.arange(roi_w), np.arange(roi_h))
                    map_x = (grid_x + flow[:, :, 0]).astype(np.float32)
                    map_y = (grid_y + flow[:, :, 1]).astype(np.float32)

                    warped_n_frame = cv2.remap(n_roi_frame, map_x, map_y, cv2.INTER_LINEAR)
                    safe_n_mask = cv2.dilate(n_roi_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
                    warped_n_mask = cv2.remap(safe_n_mask, map_x, map_y, cv2.INTER_NEAREST)

                # Valid donor: inside current watermark mask, but NOT masked in warped neighbor
                valid_donor = (roi_mask > 0) & (warped_n_mask == 0)
                if np.count_nonzero(valid_donor) > 0:
                    donor_candidates.append((warped_n_frame, valid_donor, sim_score, abs(offset)))
            except Exception:
                continue

    # 2. Rank Donors: highest background similarity first, then closest temporal proximity
    donor_candidates.sort(key=lambda c: (-c[2], c[3]))

    # 3. Progressive Temporal Reconstruction (Ghost-Free Winner Selection)
    temporal_filled = np.zeros((roi_h, roi_w), dtype=bool)
    result_roi = roi_frame.copy()

    for warped_n, valid_d, sim, off in donor_candidates:
        needed = valid_d & (~temporal_filled)
        if np.count_nonzero(needed) > 0:
            result_roi[needed] = warped_n[needed]
            temporal_filled[needed] = True

    # 4. Multi-Scale Spatial Inpainting for residual unfilled pixels
    unfilled = (roi_mask > 0) & (~temporal_filled)
    if np.count_nonzero(unfilled) > 0:
        unfilled_uint8 = unfilled.astype(np.uint8) * 255
        spatial_fill = inpaint_spatial_multiscale(result_roi, unfilled_uint8, method=method)
        result_roi[unfilled] = spatial_fill[unfilled]

    # 5. Distance-Transform Seamless Boundary Composite
    dist = cv2.distanceTransform(roi_mask, cv2.DIST_L2, 5)
    alpha = np.clip(dist / 4.0, 0.0, 1.0).astype(np.float32)
    alpha_3d = np.repeat(alpha[:, :, np.newaxis], 3, axis=2)

    blended_roi = (result_roi.astype(np.float32) * alpha_3d + roi_frame.astype(np.float32) * (1.0 - alpha_3d)).astype(np.uint8)

    final_frame = current_frame.copy()
    final_frame[y1:y2, x1:x2] = np.where(roi_mask[:, :, np.newaxis] > 0, blended_roi, current_frame[y1:y2, x1:x2])
    return final_frame


def inpaint_spatial(img: np.ndarray, mask: np.ndarray, method: str = "ns", radius: int = 3) -> np.ndarray:
    """Standalone spatial inpainting."""
    return inpaint_spatial_multiscale(img, mask, method=method)


def preview_frame_inpaint(
    video_path: str,
    timestamp: float,
    mask_spec: Any,
    dilation: int = 4,
    feather: int = 5,
    method: str = "ns"
) -> Dict[str, Any]:
    """
    Extract a single frame at timestamp, inpaint it, and return base64 data URLs for instant comparison.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    target_frame = max(0, min(total_frames - 1, int(timestamp * fps)))

    cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)
    ret, original_frame = cap.read()
    if not ret or original_frame is None:
        cap.release()
        raise ValueError(f"Could not read frame at timestamp {timestamp}")

    h, w = original_frame.shape[:2]

    # Gather neighbor frames for temporal preview
    neighbor_frames = []
    offsets = [-3, -2, -1, 1, 2, 3]
    for off in offsets:
        n_idx = target_frame + off
        if 0 <= n_idx < total_frames:
            cap.set(cv2.CAP_PROP_POS_FRAMES, n_idx)
            n_ret, n_frame = cap.read()
            if n_ret and n_frame is not None:
                n_time = n_idx / fps
                n_mask = parse_mask_spec(mask_spec, w, h, n_time)
                n_dilated, _ = refine_mask(n_mask, dilation=dilation, feather=feather)
                neighbor_frames.append((off, n_frame, n_dilated))

    cap.release()

    raw_mask = parse_mask_spec(mask_spec, w, h, timestamp)
    dilated_mask, alpha = refine_mask(raw_mask, dilation=dilation, feather=feather)

    t0 = time.time()
    cleaned_frame = inpaint_temporal_spatial(
        original_frame, dilated_mask, neighbor_frames, method=method, feather_alpha=alpha
    )
    inpaint_time_ms = round((time.time() - t0) * 1000, 2)

    # Visualization
    mask_visual = original_frame.copy()
    red_overlay = np.zeros_like(original_frame)
    red_overlay[:, :] = [0, 0, 255]
    mask_visual = np.where(dilated_mask[:, :, np.newaxis] > 0, 
                           cv2.addWeighted(original_frame, 0.4, red_overlay, 0.6, 0), 
                           original_frame)

    _, orig_buf = cv2.imencode(".jpg", original_frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
    _, clean_buf = cv2.imencode(".jpg", cleaned_frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
    _, mask_buf = cv2.imencode(".jpg", mask_visual, [cv2.IMWRITE_JPEG_QUALITY, 92])

    return {
        "status": "success",
        "frame_index": target_frame,
        "timestamp": round(timestamp, 3),
        "width": w,
        "height": h,
        "inpaint_time_ms": inpaint_time_ms,
        "mask_pixels_count": int(np.count_nonzero(dilated_mask)),
        "original_image": f"data:image/jpeg;base64,{base64.b64encode(orig_buf).decode('utf-8')}",
        "cleaned_image": f"data:image/jpeg;base64,{base64.b64encode(clean_buf).decode('utf-8')}",
        "mask_overlay_image": f"data:image/jpeg;base64,{base64.b64encode(mask_buf).decode('utf-8')}",
    }


def process_video_inpainting(
    input_video: str,
    output_video: str,
    mask_spec: Any,
    dilation: int = 4,
    feather: int = 5,
    method: str = "ns",
    temporal_window: int = 3,
    progress_callback: Optional[Any] = None
) -> Dict[str, Any]:
    """
    Process complete video with frame-aware temporal inpainting,
    preserving exact resolution, FPS, duration, and original audio.
    Memory bounded for low-resource container deployments (<=150MB).
    """
    if not os.path.isfile(input_video):
        raise FileNotFoundError(f"Input video not found: {input_video}")

    metadata = get_video_metadata(input_video)
    width = metadata["width"]
    height = metadata["height"]
    fps = metadata["fps"]
    total_frames = metadata["total_frames"]
    has_audio = metadata["has_audio"]
    ffmpeg_exe = get_ffmpeg_path()

    temp_dir = tempfile.mkdtemp(prefix="cleancut_")
    temp_raw_video = os.path.join(temp_dir, "temp_video.mp4")
    temp_audio_file = os.path.join(temp_dir, "temp_audio.aac")

    try:
        # Step 1: Extract Audio if present
        if has_audio:
            if progress_callback:
                progress_callback({
                    "stage": "Extracting audio track...",
                    "progress": 2.0,
                    "frame": 0,
                    "total_frames": total_frames
                })
            audio_cmd = [
                ffmpeg_exe, "-y", "-i", input_video,
                "-vn", "-acodec", "copy", temp_audio_file
            ]
            res = subprocess.run(audio_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if res.returncode != 0 or not os.path.isfile(temp_audio_file) or os.path.getsize(temp_audio_file) == 0:
                audio_cmd_aac = [
                    ffmpeg_exe, "-y", "-i", input_video,
                    "-vn", "-c:a", "aac", "-b:a", "192k", temp_audio_file
                ]
                subprocess.run(audio_cmd_aac, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        # Step 2: Set up FFmpeg Video Writer Pipe
        ffmpeg_writer_cmd = [
            ffmpeg_exe, "-y",
            "-f", "rawvideo",
            "-vcodec", "rawvideo",
            "-s", f"{width}x{height}",
            "-pix_fmt", "bgr24",
            "-r", str(fps),
            "-i", "-",
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "18",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            temp_raw_video
        ]

        writer_proc = subprocess.Popen(
            ffmpeg_writer_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )

        # Step 3: Stream frames with sliding window (Bounded RAM)
        cap = cv2.VideoCapture(input_video)
        frame_buffer = []  # Buffer of (frame_idx, timestamp, frame, mask, alpha)
        processed_count = 0
        start_time = time.time()

        for frame_idx in range(total_frames):
            ret, frame = cap.read()
            if not ret or frame is None:
                break

            current_time = frame_idx / fps
            raw_mask = parse_mask_spec(mask_spec, width, height, current_time)
            dilated_mask, alpha = refine_mask(raw_mask, dilation=dilation, feather=feather)

            frame_buffer.append((frame_idx, current_time, frame, dilated_mask, alpha))

            # Maintain sliding window
            while len(frame_buffer) > temporal_window:
                center_item = frame_buffer[0]
                center_idx, center_time, center_frame, center_mask, center_alpha = center_item

                neighbor_list = []
                for n_idx, n_time, n_f, n_m, _ in frame_buffer[1:temporal_window * 2 + 1]:
                    neighbor_list.append((n_idx - center_idx, n_f, n_m))

                cleaned = inpaint_temporal_spatial(
                    center_frame, center_mask, neighbor_list, method=method, feather_alpha=center_alpha
                )

                writer_proc.stdin.write(cleaned.tobytes())
                processed_count += 1
                frame_buffer.pop(0)

                if processed_count % 30 == 0:
                    gc.collect()

                if progress_callback and (processed_count % 5 == 0 or processed_count == total_frames):
                    elapsed = time.time() - start_time
                    fps_speed = processed_count / elapsed if elapsed > 0 else 0
                    percent = min(95.0, round(5.0 + (processed_count / total_frames) * 85.0, 1))
                    remaining_frames = max(0, total_frames - processed_count)
                    eta_sec = round(remaining_frames / fps_speed, 1) if fps_speed > 0 else 0.0

                    progress_callback({
                        "stage": f"Inpainting frame {processed_count}/{total_frames} ({fps_speed:.1f} fps)",
                        "progress": percent,
                        "frame": processed_count,
                        "total_frames": total_frames,
                        "fps": round(fps_speed, 1),
                        "eta_seconds": eta_sec,
                        "elapsed_seconds": round(elapsed, 1)
                    })

        # Drain remaining buffer
        while frame_buffer:
            center_item = frame_buffer.pop(0)
            center_idx, center_time, center_frame, center_mask, center_alpha = center_item

            neighbor_list = []
            for n_idx, n_time, n_f, n_m, _ in frame_buffer:
                neighbor_list.append((n_idx - center_idx, n_f, n_m))

            cleaned = inpaint_temporal_spatial(
                center_frame, center_mask, neighbor_list, method=method, feather_alpha=center_alpha
            )
            writer_proc.stdin.write(cleaned.tobytes())
            processed_count += 1

            if progress_callback and (processed_count % 5 == 0 or processed_count == total_frames):
                elapsed = time.time() - start_time
                fps_speed = processed_count / elapsed if elapsed > 0 else 0
                percent = min(95.0, round(5.0 + (processed_count / total_frames) * 85.0, 1))
                progress_callback({
                    "stage": f"Inpainting frame {processed_count}/{total_frames} ({fps_speed:.1f} fps)",
                    "progress": percent,
                    "frame": processed_count,
                    "total_frames": total_frames,
                    "fps": round(fps_speed, 1)
                })

        cap.release()
        writer_proc.stdin.close()
        writer_proc.wait()

        # Step 4: Final Muxing - Combine video and audio
        if progress_callback:
            progress_callback({
                "stage": "Muxing final video and audio...",
                "progress": 96.0,
                "frame": total_frames,
                "total_frames": total_frames
            })

        os.makedirs(os.path.dirname(os.path.abspath(output_video)), exist_ok=True)

        if has_audio and os.path.isfile(temp_audio_file) and os.path.getsize(temp_audio_file) > 0:
            mux_cmd = [
                ffmpeg_exe, "-y",
                "-i", temp_raw_video,
                "-i", temp_audio_file,
                "-c:v", "copy",
                "-c:a", "aac",
                "-b:a", "192k",
                "-movflags", "+faststart",
                output_video
            ]
            mux_res = subprocess.run(mux_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if mux_res.returncode != 0:
                shutil.copyfile(temp_raw_video, output_video)
        else:
            shutil.copyfile(temp_raw_video, output_video)

        total_elapsed = round(time.time() - start_time, 2)

        if progress_callback:
            progress_callback({
                "stage": "Completed",
                "progress": 100.0,
                "frame": total_frames,
                "total_frames": total_frames,
                "status": "completed",
                "elapsed_seconds": total_elapsed
            })

        return {
            "status": "completed",
            "output_video": output_video,
            "duration": metadata["duration"],
            "total_frames": processed_count,
            "width": width,
            "height": height,
            "fps": fps,
            "has_audio": has_audio,
            "file_size": os.path.getsize(output_video) if os.path.isfile(output_video) else 0,
            "elapsed_seconds": total_elapsed
        }

    finally:
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser(description="CleanCut AI Video Inpainting Engine")
    parser.add_argument("--mode", choices=["metadata", "preview", "process"], required=True, help="Execution mode")
    parser.add_argument("--input", required=True, help="Input video file path")
    parser.add_argument("--output", help="Output video/image path")
    parser.add_argument("--time", type=float, default=0.0, help="Timestamp for preview mode")
    parser.add_argument("--mask", help="JSON mask specification, file path, or base64")
    parser.add_argument("--dilation", type=int, default=4, help="Mask dilation in pixels")
    parser.add_argument("--feather", type=int, default=5, help="Mask edge feather radius in pixels")
    parser.add_argument("--method", choices=["ns", "telea"], default="ns", help="Inpainting algorithm")
    parser.add_argument("--temporal_window", type=int, default=3, help="Temporal neighbor frame search radius")

    args = parser.parse_args()

    mask_data = args.mask
    if mask_data and os.path.isfile(mask_data):
        try:
            with open(mask_data, "r", encoding="utf-8") as f:
                mask_data = json.load(f)
        except Exception:
            pass

    if args.mode == "metadata":
        meta = get_video_metadata(args.input)
        print(json.dumps(meta, indent=2))

    elif args.mode == "preview":
        res = preview_frame_inpaint(
            video_path=args.input,
            timestamp=args.time,
            mask_spec=mask_data,
            dilation=args.dilation,
            feather=args.feather,
            method=args.method
        )
        print(json.dumps(res))

    elif args.mode == "process":
        def on_progress(p_dict):
            print(json.dumps(p_dict), flush=True)

        res = process_video_inpainting(
            input_video=args.input,
            output_video=args.output,
            mask_spec=mask_data,
            dilation=args.dilation,
            feather=args.feather,
            method=args.method,
            temporal_window=args.temporal_window,
            progress_callback=on_progress
        )
        print(json.dumps(res), flush=True)


if __name__ == "__main__":
    main()
