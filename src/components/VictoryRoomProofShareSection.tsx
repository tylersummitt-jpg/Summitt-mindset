"use client";

import { useCallback, useMemo, useState } from "react";
import { VictoryMomentCard } from "@/components/VictoryMomentCard";
import { VictoryShareCardPreview } from "@/components/VictoryShareCardPreview";
import { buildShareSnippetFromMoment, type VictoryRoomViewForShare } from "@/lib/v2-victory-share-snippet";

type MomentRow = {
  id: string;
  headline: string;
  body: string;
  dateLabel: string;
  groundedInEventTypes: string[];
};

type VictoryRoomProofShareSectionProps = {
  viewForShare: VictoryRoomViewForShare;
  moments: MomentRow[];
};

export function VictoryRoomProofShareSection({ viewForShare, moments }: VictoryRoomProofShareSectionProps) {
  const [openMomentId, setOpenMomentId] = useState<string | null>(null);

  const snippet = useMemo(() => {
    if (!openMomentId) return null;
    return buildShareSnippetFromMoment(viewForShare, openMomentId);
  }, [viewForShare, openMomentId]);

  const handleShareClick = useCallback((momentId: string) => {
    setOpenMomentId(momentId);
  }, []);

  const handleClose = useCallback(() => {
    setOpenMomentId(null);
  }, []);

  if (moments.length === 0) return null;

  return (
    <>
      <ul className="mt-6 space-y-4">
        {moments.map((m) => (
          <li key={m.id}>
            <VictoryMomentCard
              headline={m.headline}
              body={m.body}
              dateLabel={m.dateLabel}
              groundedInEventTypes={m.groundedInEventTypes}
              momentId={m.id}
              onShareProof={handleShareClick}
            />
          </li>
        ))}
      </ul>
      {openMomentId && snippet ? <VictoryShareCardPreview snippet={snippet} onClose={handleClose} /> : null}
    </>
  );
}
