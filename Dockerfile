# Production Dockerfile for CleanCut AI Inpainting Backend
FROM python:3.11-slim

# Install system dependencies including FFmpeg and OpenCV runtime libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source code and public assets
COPY backend/ ./backend/
COPY public/ ./public/

# Set environment defaults (PORT fallback to 8000 if not supplied by cloud host)
ENV PORT=8000 \
    PYTHONUNBUFFERED=1 \
    STORAGE_DIR=/app/storage \
    MAX_UPLOAD_MB=500 \
    ALLOWED_ORIGINS=*

# Create storage directories
RUN mkdir -p /app/storage/uploads /app/storage/outputs

# Informational exposed ports
EXPOSE 8000 10000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8000}/health || exit 1

# Start FastAPI application dynamically bound to $PORT supplied by Render/Host
CMD sh -c "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"
