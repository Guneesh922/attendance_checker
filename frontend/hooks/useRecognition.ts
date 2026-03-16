"use client";
import { useRef, useCallback, useState } from "react";
import { recognize } from "../lib/api";

const POLL_MS = 2000; // poll every 2 s

export function useRecognition(captureBase64: () => string | null) {
  const [detected, setDetected] = useState<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(() => {
    timerRef.current = setInterval(async () => {
      const b64 = captureBase64();
      if (!b64) return;
      try {
        const { data } = await recognize(b64);
        setDetected(data.names ?? []);
      } catch {
        // network hiccup — keep polling silently
      }
    }, POLL_MS);
  }, [captureBase64]);

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setDetected([]);
  }, []);

  return { detected, start, stop };
}
