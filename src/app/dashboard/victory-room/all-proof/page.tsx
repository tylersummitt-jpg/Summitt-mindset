import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { VictoryAllProofSection } from "@/components/VictoryAllProofSection";
import { vrPageGlow, vrPageInner, vrPageOuter } from "@/components/victory-room-visual";
import { resolveUserTimezone } from "@/lib/timezone";
import { loadVictoryAllProofView } from "@/lib/v2-victory-all-proof-view";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?:
    | Promise<{ cursor?: string }>
    | { cursor?: string };
};

async function resolveCursorSearchParams(
  searchParams: PageProps["searchParams"]
): Promise<{ cursor?: string }> {
  if (!searchParams) return {};
  return searchParams instanceof Promise ? await searchParams : searchParams;
}

export default async function VictoryAllProofPage({ searchParams }: PageProps) {
  const user = await currentUser();
  if (!user?.id) redirect("/sign-in");

  const md = (user.publicMetadata || {}) as Record<string, unknown>;
  const timeZone = resolveUserTimezone(md?.timezone);
  const params = await resolveCursorSearchParams(searchParams);

  const allWins = await loadVictoryAllProofView(user.id, {
    cursorRaw: typeof params.cursor === "string" ? params.cursor : null,
  });

  return (
    <div className={`victory-room-route-canvas ${vrPageOuter}`}>
      <div className={vrPageGlow} aria-hidden />
      <main className={vrPageInner}>
        <VictoryAllProofSection
          wins={allWins.wins}
          timeZone={timeZone}
          hasMore={allWins.hasMore}
          nextCursor={allWins.nextCursor}
        />
      </main>
    </div>
  );
}
