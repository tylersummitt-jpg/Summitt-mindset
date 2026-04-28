"use client";

import { forwardRef } from "react";
import {
  VICTORY_PROOF_EXPORT_HEIGHT as H,
  VICTORY_PROOF_EXPORT_WIDTH as W,
} from "@/lib/victory-proof-export-image";
import type { VictoryShareSnippet } from "@/lib/v2-victory-share-snippet";

const fontStack = 'ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const fontSans = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

type VictoryProofExportFrameProps = {
  snippet: VictoryShareSnippet;
};

/**
 * Offscreen, fixed-size card for PNG capture only. Content must match `VictoryShareSnippet` fields exactly.
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
          left: -12000,
          top: 0,
          width: W,
          height: H,
          boxSizing: "border-box",
          margin: 0,
          padding: 0,
          pointerEvents: "none",
          zIndex: -10,
          overflow: "hidden",
          backgroundColor: "#fafaf9",
          fontFamily: fontSans,
          color: "#1c1917",
        }}
      >
        <div
          style={{
            display: "flex",
            width: "100%",
            height: "100%",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              width: 8,
              flexShrink: 0,
              backgroundColor: "#78716c",
            }}
          />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              padding: "72px 64px 56px",
              display: "flex",
              flexDirection: "column",
              boxSizing: "border-box",
            }}
          >
            <p
              style={{
                margin: 0,
                fontFamily: fontStack,
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                lineHeight: 1.25,
                color: "#0c0a09",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {snippet.title}
            </p>
            {snippet.identityLine ? (
              <p
                style={{
                  margin: "16px 0 0",
                  fontSize: 22,
                  lineHeight: 1.45,
                  color: "#44403c",
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {snippet.identityLine}
              </p>
            ) : null}

            <div style={{ flex: 1, minHeight: 24 }} />

            <p
              style={{
                margin: 0,
                fontFamily: fontStack,
                fontSize: 38,
                fontWeight: 500,
                lineHeight: 1.38,
                color: "#0c0a09",
                display: "-webkit-box",
                WebkitLineClamp: 14,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {snippet.body}
            </p>

            <div style={{ flex: 1, minHeight: 32 }} />

            {snippet.barLine ? (
              <p
                style={{
                  margin: 0,
                  fontSize: 20,
                  lineHeight: 1.5,
                  color: "#57534e",
                  display: "-webkit-box",
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {snippet.barLine}
              </p>
            ) : null}

            {snippet.barLine ? <div style={{ height: 28 }} /> : null}

            <p
              style={{
                margin: 0,
                fontSize: 16,
                letterSpacing: "0.04em",
                color: "#78716c",
              }}
            >
              {snippet.attribution}
            </p>
          </div>
        </div>
      </div>
    );
  }
);
