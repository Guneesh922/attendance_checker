"use client";
import { useEffect, useState } from "react";

// Module-level singletons — loaded once across the whole session
let faceapi: typeof import("face-api.js") | null = null;
let modelsLoaded = false;

// Cached FaceMatcher — rebuilt only when the employee list changes
let cachedMatcher: InstanceType<(typeof import("face-api.js"))["FaceMatcher"]> | null = null;
let cachedMatcherKey = "";

async function getFaceApi() {
  if (typeof window === "undefined") throw new Error("Browser only");
  if (!faceapi) faceapi = await import("face-api.js");
  return faceapi;
}

const MODELS_URL = "/models";

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

/** Extract one face descriptor from a canvas. Returns null if no face detected. */
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

type EmployeeInput = { name: string; face_descriptors: number[][] };

/**
 * Detect all faces in a video or canvas element and match against stored employee descriptors.
 * FaceMatcher is cached and only rebuilt when the employee list changes.
 */
export async function detectAndMatch(
  input: HTMLVideoElement | HTMLCanvasElement,
  employees: EmployeeInput[]
): Promise<DetectedFace[]> {
  const api = await loadModels();
  const detections = await api
    .detectAllFaces(input, new api.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();

  if (!detections.length) return [];

  // Rebuild matcher only when the employee list actually changes
  const matcherKey = employees
    .map((e) => `${e.name}:${e.face_descriptors.length}`)
    .join(",");

  if (matcherKey !== cachedMatcherKey) {
    const labeled = employees
      .filter((e) => e.face_descriptors?.length > 0)
      .map(
        (e) =>
          new api.LabeledFaceDescriptors(
            e.name,
            e.face_descriptors.map((d) => new Float32Array(d))
          )
      );
    cachedMatcher = labeled.length ? new api.FaceMatcher(labeled, 0.5) : null;
    cachedMatcherKey = matcherKey;
  }

  if (!cachedMatcher) {
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

  const matcher = cachedMatcher;
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
