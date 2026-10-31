"use client";

import { PauseIcon, PlayIcon } from "@phosphor-icons/react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";

// WebGL never runs on the server: the shader is a client-only chunk, loaded
// after the page is interactive. Until then (and without WebGL) the band shows
// its static cobalt fallback, drawn in CSS from the same tokens.
const DitherShader = dynamic(() => import("./DitherShader").then((mod) => mod.DitherShader), {
  ssr: false,
  loading: () => null,
});

/**
 * Thin decorative band between the hero and the register. It moves slowly and
 * forever, so it carries its own pause control (WCAG 2.2.2); under reduced
 * motion it is a still frame and the control is not needed.
 */
export function DitherBand() {
  const [paused, setPaused] = useState(false);

  return (
    <div className="relative">
      <div aria-hidden="true" className="dither-fallback relative h-[120px] overflow-hidden border-y border-border">
        <DitherShader paused={paused} />
      </div>
      <Button
        variant="outline"
        size="icon-xs"
        className="absolute right-3 bottom-3 motion-reduce:hidden sm:right-4"
        aria-pressed={paused}
        aria-label="Pause the background animation"
        onClick={() => setPaused((value) => !value)}
      >
        {paused ? <PlayIcon aria-hidden="true" weight="fill" /> : <PauseIcon aria-hidden="true" weight="fill" />}
      </Button>
    </div>
  );
}
