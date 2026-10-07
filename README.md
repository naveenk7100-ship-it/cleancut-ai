# CleanCut AI — Video Watermark Inpainting Platform

> **Clean your videos, not your quality.**

CleanCut AI is a production-ready web application for removing watermarks and logos from videos using temporal neighbor-frame reconstruction and Navier-Stokes PDE inpainting.

---

## Deployment Architecture

```
┌──────────────────────────────────────┐       HTTPS / SSE       ┌─────────────────────────────────────────┐
│          Next.js Frontend            │ ──────────────────────> │         FastAPI Python Backend          │
│         (Deployed on Vercel)         │                         │    (Docker: Render / Railway / Fly)     │
│                                      │                         │                                         │
│ • Interactive Canvas & Keyframe UI   │ <────────────────────── │ • Temporal & Spatial Inpainting Engine │
│ • Video Timeline Scrubber            │     Direct MP4 Stream   │ • Optical Flow Motion Compensation      │
│ • Before/After Split Comparison      │                         │ • Lossless Audio Muxing (FFmpeg)        │
└──────────────────────────────────────┘                         └─────────────────────────────────────────┘
```

---

## Deployment Guide

### 1. Deploying the Backend (Container Platform)

Deploy the Python backend to any container host (e.g., Render, Railway, Fly.io, or AWS ECS).

#### Option A: Deploy to Render (Recommended Free/Low-Cost)
1. Push this repository to GitHub.
2. Log in to [Render Dashboard](https://dashboard.render.com).
3. Click **New +** $\rightarrow$ **Web Service** $\rightarrow$ Connect your repository.
4. Select **Docker** environment (or Root Directory `./`).
5. Configure Environment Variables:
   * `ALLOWED_ORIGINS`: `https://<your-vercel-app>.vercel.app` (or `*`)
   * `MAX_UPLOAD_MB`: `500`
   * `PORT`: `8000`
6. Click **Deploy Web Service**.
7. Note down your backend URL: e.g. `https://cleancut-backend.onrender.com`.

#### Option B: Deploy with Docker CLI
```bash
# Build the backend image
docker build -t cleancut-backend .

# Run the container
docker run -d -p 8000:8000 -e ALLOWED_ORIGINS="*" --name cleancut cleancut-backend
```

---

### 2. Deploying the Frontend (Vercel)

1. Install the Vercel CLI (or connect via GitHub on [vercel.com](https://vercel.com)):
```bash
npm i -g vercel
```
2. Navigate to the project root:
```bash
cd cleancut-ai
```
3. Link and Deploy to Vercel:
```bash
vercel login
vercel link
vercel env add NEXT_PUBLIC_API_URL
# When prompted, enter your backend URL: https://cleancut-backend.onrender.com
vercel --prod
```

---

## Local Development & Testing

### 1. Start the FastAPI Backend
```bash
# In terminal 1:
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Start the Next.js Frontend
```bash
# In terminal 2:
npm run dev
# Open http://localhost:3000
```

### 3. Automated End-to-End Verification
```bash
python backend/test_e2e.py
```
