import type { ReactNode } from "react";
import { programsTeaching } from "@/components/programs/programs-visual";

export function ProgramsTeaching({ children }: { children: ReactNode }) {
  return <section className={programsTeaching}>{children}</section>;
}
