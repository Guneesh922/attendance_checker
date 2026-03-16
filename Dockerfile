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

# Limit compilation to 1 thread to prevent OOM
ENV CMAKE_BUILD_PARALLEL_LEVEL=1

# Fix for newer CMake compatibility with dlib 19.24.2
ENV CMAKE_POLICY_VERSION_MINIMUM=3.5

# Install pip dependencies and upgrade build tools
RUN pip install --upgrade pip setuptools wheel

# COPY requirements before installing — this line was missing
COPY requirements.txt .

RUN pip install --no-cache-dir dlib==19.24.2
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the code
COPY . .

EXPOSE 8000

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]