"use client";

import { useCallback, useMemo, useState } from "react";
import { VictoryMomentCard } from "@/components/VictoryMomentCard";
import { VictoryShareCardPreview } from "@/components/VictoryShareCardPreview";
import { buildShareSnippetFromMoment, type VictoryRoomViewForShare } from "@/lib/v2-victory-share-snippet";

type MomentRow = {
  id: string;
  categoryLabel?: string;
  headline: string;
  body: string;
  quote?: string | null;
  meaning?: string | null;
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
    const row = moments.find((m) => m.id === openMomentId);
    return buildShareSnippetFromMoment(viewForShare, openMomentId, {
      categoryLabel: row?.categoryLabel,
      dateLabel: row?.dateLabel,
    });
  }, [viewForShare, openMomentId, moments]);

  const handleShareClick = useCallback((momentId: string) => {
    setOpenMomentId(momentId);
  }, []);

  const handleClose = useCallback(() => {
    setOpenMomentId(null);
  }, []);

  if (moments.length === 0) return null;

  return (
    <>
      <ul className="mt-8 space-y-4">
        {moments.map((m) => (
          <li key={m.id}>
            <VictoryMomentCard
              categoryLabel={m.categoryLabel}
              headline={m.headline}
              body={m.body}
              quote={m.quote}
              meaning={m.meaning}
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
