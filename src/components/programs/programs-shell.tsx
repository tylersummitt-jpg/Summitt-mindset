import type { ReactNode } from "react";
import {
  utPageCanvas,
  utPageInnerAskPat,
} from "@/components/utility-page-visual";

export function ProgramsShell({ children }: { children: ReactNode }) {
  return (
    <main className={utPageCanvas}>
      <div className={`${utPageInnerAskPat} overflow-x-hidden`}>{children}</div>
    </main>
  );
}
