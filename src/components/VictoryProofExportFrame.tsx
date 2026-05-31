"use client";

import { forwardRef } from "react";
import { VictoryCardShareLayout } from "@/components/VictoryCardShareLayout";
import {
  VICTORY_PROOF_EXPORT_HEIGHT as H,
  VICTORY_PROOF_EXPORT_WIDTH as W,
} from "@/lib/victory-proof-export-image";
import type { VictoryShareSnippet } from "@/lib/v2-victory-share-snippet";

type VictoryProofExportFrameProps = {
  snippet: VictoryShareSnippet;
};

/**
 * Offscreen, fixed-size card for PNG capture only. Uses the same layout as the modal preview.
 */
export const VictoryProofExportFrame = forwardRef<HTMLDivElement, VictoryProofExportFrameProps>(
  function VictoryProofExportFrame({ snippet }, ref) {
    return (
      <div
        ref={ref}
        aria-hidden
        className="victory-proof-export-root"
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          width: W,
          height: H,
          boxSizing: "border-box",
          margin: 0,
          padding: 0,
          opacity: 0,
          pointerEvents: "none",
          zIndex: 0,
          overflow: "hidden",
        }}
      >
        <VictoryCardShareLayout snippet={snippet} variant="export" />
      </div>
    );
  }
);
