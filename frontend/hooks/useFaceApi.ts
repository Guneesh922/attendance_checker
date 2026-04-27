"use client";
import { useEffect, useState } from "react";

// Module-level singletons — loaded once across the whole session
let faceapi: typeof import("face-api.js") | null = null;
let modelsLoaded = false;

async function getFaceApi() {
  if (typeof window === "undefined") throw new Error("Browser only");
  if (!faceapi) faceapi = await import("face-api.js");
  return faceapi;
}

const MODELS_URL = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights";

export async function loadModels() {
  const api = await getFaceApi();
  if (!modelsLoaded) {
    await Promise.all([
      api.nets.ssdMobilenetv1.loadFromUri(MODELS_URL),
      api.nets.faceLandmark68Net.loadFromUri(MODELS_URL),
      api.nets.faceRecognitionNet.loadFromUri(MODELS_URL),
    ]);
    modelsLoaded = true;
  }
  return api;
}

/** Extract one face descriptor from a canvas snapshot of the current video frame.
 *  Returns null if no face is detected. */
export async function extractDescriptorFromCanvas(
  canvas: HTMLCanvasElement
): Promise<number[] | null> {
  const api = await loadModels();
  const det = await api
    .detectSingleFace(canvas, new api.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  return det ? Array.from(det.descriptor) : null;
}

export interface DetectedFace {
  name: string | null;
  box: { top: number; right: number; bottom: number; left: number };
}

/** Detect all faces in a video element and match against stored employee descriptors. */
export async function detectAndMatch(
  videoEl: HTMLVideoElement,
  employees: Array<{ name: string; face_descriptors: number[][] }>
): Promise<DetectedFace[]> {
  const api = await loadModels();
  const detections = await api
    .detectAllFaces(videoEl, new api.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();

  if (!detections.length) return [];

  const labeled = employees
    .filter((e) => e.face_descriptors?.length > 0)
    .map(
      (e) =>
        new api.LabeledFaceDescriptors(
          e.name,
          e.face_descriptors.map((d) => new Float32Array(d))
        )
    );

  if (!labeled.length) {
    return detections.map((d) => ({
      name: null,
      box: {
        top: d.detection.box.top,
        right: d.detection.box.right,
        bottom: d.detection.box.bottom,
        left: d.detection.box.left,
      },
    }));
  }

  const matcher = new api.FaceMatcher(labeled, 0.5);
  return detections.map((d) => {
    const match = matcher.findBestMatch(d.descriptor);
    return {
      name: match.label === "unknown" ? null : match.label,
      box: {
        top: d.detection.box.top,
        right: d.detection.box.right,
        bottom: d.detection.box.bottom,
        left: d.detection.box.left,
      },
    };
  });
}

/** React hook: loads face-api.js models and tracks load status. */
export function useFaceApi() {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    setStatus("loading");
    loadModels()
      .then(() => setStatus("ready"))
      .catch(() => setStatus("error"));
  }, []);

  return status;
}
