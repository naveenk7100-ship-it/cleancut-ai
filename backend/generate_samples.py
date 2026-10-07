#!/usr/bin/env python3
"""
CleanCut AI - Sample Video Generator
Generates realistic sample videos with audio and watermarks for testing:
1. Landscape 16:9 sample with fixed watermark + camera motion + audio tone
2. Portrait 9:16 sample with moving watermark + audio tone
"""

import os
import sys
import math
import subprocess
import cv2
import numpy as np

try:
    import imageio_ffmpeg
    FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    FFMPEG_EXE = "ffmpeg"


def create_audio_track(output_wav: str, duration: float = 4.0):
    """Generate a clean synthetic audio melody/tone track."""
    sample_rate = 44100
    n_samples = int(sample_rate * duration)
    t = np.linspace(0, duration, n_samples, False)

    # Melody: C4 (261.63Hz), E4 (329.63Hz), G4 (392.00Hz), C5 (523.25Hz)
    notes = [261.63, 329.63, 392.00, 523.25]
    audio = np.zeros(n_samples, dtype=np.float32)

    note_dur = duration / len(notes)
    for i, freq in enumerate(notes):
        start_idx = int(i * note_dur * sample_rate)
        end_idx = int((i + 1) * note_dur * sample_rate)
        t_segment = t[start_idx:end_idx]
        envelope = np.sin(np.pi * np.linspace(0, 1, end_idx - start_idx)) ** 0.5
        segment_audio = 0.4 * np.sin(2 * np.pi * freq * t_segment) * envelope
        audio[start_idx:end_idx] = segment_audio

    # Convert to 16-bit PCM WAV
    audio_int16 = (audio * 32767).astype(np.int16)
    import wave
    with wave.open(output_wav, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(audio_int16.tobytes())


def generate_landscape_sample(output_mp4: str):
    """Generate 1280x720 16:9 video with animated background and static watermark."""
    width, height = 1280, 720
    fps = 30
    duration = 4.0
    total_frames = int(fps * duration)

    temp_video = output_mp4 + ".temp.mp4"
    temp_audio = output_mp4 + ".temp.wav"
    create_audio_track(temp_audio, duration)

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(temp_video, fourcc, fps, (width, height))

    # Watermark text and position (top-right)
    wm_text = "SAMPLE WATERMARK"
    wm_x, wm_y, wm_w, wm_h = 880, 50, 350, 70

    for i in range(total_frames):
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        
        # Dynamic animated background with gradient and moving geometric shapes
        t = i / fps
        angle = t * 1.5
        
        # Background gradient
        for y in range(height):
            r = int(15 + 40 * math.sin(angle + y / 150))
            g = int(30 + 50 * math.cos(angle * 0.8 + y / 120))
            b = int(70 + 60 * math.sin(angle * 1.2 + y / 100))
            frame[y, :] = [np.clip(b, 0, 255), np.clip(g, 0, 255), np.clip(r, 0, 255)]

        # Moving spheres
        cx1 = int(width * 0.4 + 200 * math.cos(angle))
        cy1 = int(height * 0.5 + 120 * math.sin(angle * 1.5))
        cv2.circle(frame, (cx1, cy1), 90, (255, 180, 50), -1, cv2.LINE_AA)
        
        cx2 = int(width * 0.7 + 180 * math.sin(angle * 0.7))
        cy2 = int(height * 0.4 + 140 * math.cos(angle))
        cv2.circle(frame, (cx2, cy2), 120, (60, 230, 210), -1, cv2.LINE_AA)

        # Dynamic floating grid lines
        offset_x = int((i * 4) % 100)
        for gx in range(-100, width + 100, 100):
            cv2.line(frame, (gx + offset_x, 0), (gx + offset_x, height), (40, 60, 90), 1)

        # Frame timestamp text
        cv2.putText(frame, f"CleanCut AI Test - Frame {i+1:03d}/{total_frames:03d} (16:9)", 
                    (40, height - 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)

        # Overlay Watermark box with semi-transparent badge and crisp text
        wm_overlay = frame.copy()
        cv2.rectangle(wm_overlay, (wm_x, wm_y), (wm_x + wm_w, wm_y + wm_h), (20, 20, 20), -1)
        cv2.putText(wm_overlay, wm_text, (wm_x + 15, wm_y + 45), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 230, 255), 2, cv2.LINE_AA)
        frame = cv2.addWeighted(wm_overlay, 0.85, frame, 0.15, 0)

        out.write(frame)

    out.release()

    # Mux H.264 video with AAC audio
    mux_cmd = [
        FFMPEG_EXE, "-y",
        "-i", temp_video,
        "-i", temp_audio,
        "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        output_mp4
    ]
    subprocess.run(mux_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    # Cleanup
    for p in [temp_video, temp_audio]:
        if os.path.isfile(p):
            os.remove(p)


def generate_portrait_sample(output_mp4: str):
    """Generate 720x1280 9:16 portrait video with moving watermark across frames."""
    width, height = 720, 1280
    fps = 30
    duration = 4.0
    total_frames = int(fps * duration)

    temp_video = output_mp4 + ".temp.mp4"
    temp_audio = output_mp4 + ".temp.wav"
    create_audio_track(temp_audio, duration)

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(temp_video, fourcc, fps, (width, height))

    wm_text = "MOVING LOGO"
    wm_w, wm_h = 260, 60

    for i in range(total_frames):
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        t = i / fps
        angle = t * 1.8

        # Background gradient
        for y in range(height):
            r = int(50 + 40 * math.sin(angle + y / 160))
            g = int(20 + 30 * math.cos(angle * 1.1 + y / 140))
            b = int(60 + 50 * math.sin(angle * 0.9 + y / 120))
            frame[y, :] = [np.clip(b, 0, 255), np.clip(g, 0, 255), np.clip(r, 0, 255)]

        # Moving circles
        cy = int(height * 0.5 + 250 * math.sin(angle))
        cv2.circle(frame, (int(width * 0.5), cy), 140, (240, 120, 80), -1, cv2.LINE_AA)

        # Bottom label
        cv2.putText(frame, f"Portrait 9:16 - Frame {i+1:03d}/{total_frames}", 
                    (40, height - 60), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)

        # Moving watermark position: starts at (50, 150) and moves to (400, 800)
        progress = i / max(1, total_frames - 1)
        wm_x = int(50 + progress * (width - wm_w - 100))
        wm_y = int(150 + progress * 650)

        wm_overlay = frame.copy()
        cv2.rectangle(wm_overlay, (wm_x, wm_y), (wm_x + wm_w, wm_y + wm_h), (30, 30, 30), -1)
        cv2.putText(wm_overlay, wm_text, (wm_x + 15, wm_y + 40), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 240, 200), 2, cv2.LINE_AA)
        frame = cv2.addWeighted(wm_overlay, 0.85, frame, 0.15, 0)

        out.write(frame)

    out.release()

    mux_cmd = [
        FFMPEG_EXE, "-y",
        "-i", temp_video,
        "-i", temp_audio,
        "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        output_mp4
    ]
    subprocess.run(mux_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    for p in [temp_video, temp_audio]:
        if os.path.isfile(p):
            os.remove(p)


def main():
    public_samples_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "samples")
    os.makedirs(public_samples_dir, exist_ok=True)

    landscape_path = os.path.join(public_samples_dir, "landscape_watermark_sample.mp4")
    portrait_path = os.path.join(public_samples_dir, "portrait_moving_watermark_sample.mp4")

    print("Generating landscape sample video...")
    generate_landscape_sample(landscape_path)
    print(f"Generated: {landscape_path}")

    print("Generating portrait 9:16 sample video...")
    generate_portrait_sample(portrait_path)
    print(f"Generated: {portrait_path}")

    print("Sample generation complete!")


if __name__ == "__main__":
    main()
