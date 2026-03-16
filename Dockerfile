FROM python:3.10-slim

# Install system dependencies required by dlib and OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake \
    g++ \
    build-essential \
    python3-dev \
    libopenblas-dev \
    liblapack-dev \
    libx11-dev \
    libboost-python-dev \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .

# Limit compilation to 1 thread to prevent OOM
ENV CMAKE_BUILD_PARALLEL_LEVEL=1

# Install pip dependencies
RUN pip install --upgrade pip
RUN pip install --no-cache-dir dlib==19.24.2
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# --workers 1 is intentional: face_recognition is CPU-bound and the
# in-memory encoding list is not safe to share across forked workers.
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
