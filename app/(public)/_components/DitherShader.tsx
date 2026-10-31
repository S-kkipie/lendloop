"use client";

import { Dithering } from "@paper-design/shaders-react";
import { useReducedMotion } from "motion/react";
import { useState } from "react";

const SPEED = 0.25;

/**
 * Resolves a colour token (an OKLCH value in globals.css) to the rgb() string
 * the shader understands, by painting one pixel. Keeps globals.css the single
 * source of every colour instead of copying hex values here.
 */
function readToken(name: string): string | null {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!value || !context) return null;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Paper Dithering, cobalt on paper. The shader pauses itself while it is off
 * screen or the tab is hidden (its own IntersectionObserver and
 * visibilitychange listener); under reduced motion, or when the visitor pauses
 * it, it holds the current frame (speed 0 also stops its animation loop).
 */
export function DitherShader({ paused = false }: { paused?: boolean }) {
  const reduceMotion = useReducedMotion();
  // Client-only component (next/dynamic, ssr: false): the DOM is available here.
  const [colors] = useState(() => ({ back: readToken("--background"), front: readToken("--primary") }));
  if (!colors.back || !colors.front) return null;

  return (
    <Dithering
      className="absolute inset-0 animate-[fade-in_300ms_var(--ease-out)_both]"
      colorBack={colors.back}
      colorFront={colors.front}
      shape="warp"
      type="4x4"
      size={2.5}
      speed={reduceMotion || paused ? 0 : SPEED}
      minPixelRatio={1}
      width="100%"
      height="100%"
    />
  );
}
