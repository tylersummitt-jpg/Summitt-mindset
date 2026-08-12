import { currentUser } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { vrPageGlow, vrPageInner, vrPageOuter } from "@/components/victory-room-visual";
import { getDateKeyInTimezone, resolveUserTimezone } from "@/lib/timezone";
import {
  editWinOriginHref,
  parseEditWinOrigin,
} from "@/lib/v2-win-edit-origin";
import {
  detailsFieldFromWin,
  loadManualWinSeasonOptionsForUser,
  loadOwnedActiveWinForEdit,
  occurredOnFromWinOccurredAt,
} from "@/lib/v2-win-user-edit";
import { enrichPublicWinsWithMedia } from "@/lib/victory-media/enrich-public-wins-with-media";
import type { PublicWinDto } from "@/lib/v2-win-public-read";
import EditWinClient from "./edit-win-client";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ winId: string }> | { winId: string };
  searchParams?:
    | Promise<{ from?: string }>
    | { from?: string };
};

async function resolveParams(params: PageProps["params"]) {
  return params instanceof Promise ? await params : params;
}

async function resolveSearchParams(searchParams: PageProps["searchParams"]) {
  if (!searchParams) return {};
  return searchParams instanceof Promise ? await searchParams : searchParams;
}

export default async function VictoryRoomEditWinPage({ params, searchParams }: PageProps) {
  const user = await currentUser();
  if (!user?.id) redirect("/sign-in");

  const { winId: rawWinId } = await resolveParams(params);
  const winId = typeof rawWinId === "string" ? rawWinId.trim() : "";
  if (!winId) notFound();

  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  const timeZone = resolveUserTimezone(md?.timezone);
  const sp = await resolveSearchParams(searchParams);
  const origin = parseEditWinOrigin(sp.from);
  const cancelHref = editWinOriginHref(origin);

  const win = await loadOwnedActiveWinForEdit({
    clerkUserId: user.id,
    winId,
  });
  if (!win) notFound();

  const seasonOptions = await loadManualWinSeasonOptionsForUser({
    clerkUserId: user.id,
    timeZone,
  });

  const today = getDateKeyInTimezone(new Date(), timeZone);
  const occurredOn = occurredOnFromWinOccurredAt(win.occurredAt, timeZone);

  // Fail-soft: enricher returns the stub unchanged when media/signing fails.
  const stub: PublicWinDto = {
    id: win.id,
    occurredAt: win.occurredAt,
    displayTitle: win.displayTitle,
    displayBody: win.displayBody,
    supportingQuote: win.supportingQuote,
    celebrationAppropriate: true,
    commitmentId: win.commitmentId,
    updatedAt: win.updatedAt,
  };
  const [enriched] = await enrichPublicWinsWithMedia({
    clerkUserId: user.id,
    wins: [stub],
  });
  const media = enriched?.media ?? null;

  return (
    <div className={`victory-room-route-canvas ${vrPageOuter}`}>
      <div className={vrPageGlow} aria-hidden />
      <main className={vrPageInner}>
        <EditWinClient
          winId={win.id}
          maxOccurredOn={today}
          initialOccurredOn={occurredOn}
          initialTitle={win.displayTitle}
          initialDetails={detailsFieldFromWin(win)}
          initialSeasonId={win.matchedSeasonId ?? ""}
          expectedUpdatedAt={win.updatedAt}
          seasonOptions={seasonOptions}
          cancelHref={cancelHref}
          orphanCommitmentNotice={win.orphanCommitment}
          media={media}
        />
      </main>
    </div>
  );
}
