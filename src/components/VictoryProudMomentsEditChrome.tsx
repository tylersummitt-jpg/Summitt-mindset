"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { VictoryRoomSectionShell } from "@/components/VictoryRoomSectionShell";
import { VictoryWinCard, type VictoryWinCardProps } from "@/components/VictoryWinCard";
import { vrAccentLink } from "@/components/victory-room-visual";

export type VictoryProudMomentCardInput = Omit<
  VictoryWinCardProps,
  "showEditingControls"
> & {
  winId: string;
  editHref: string;
  expectedUpdatedAt: string;
};

export type VictoryProudMomentCardGroup = {
  key: string;
  heading?: string;
  headingId?: string;
  cards: VictoryProudMomentCardInput[];
};

const toolbarRowClass =
  "flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-6";

const modeToggleClass = `${vrAccentLink} inline-flex min-h-11 items-center`;

type VictoryProudMomentsEditChromeProps = {
  addHref: string;
  addLabel: string;
  groups: VictoryProudMomentCardGroup[];
  header?: ReactNode;
  footer?: ReactNode;
  emptyState?: ReactNode;
  /** Wraps the card list in a Victory Room section (season detail). */
  sectionTitle?: string;
  className?: string;
};

export function VictoryProudMomentsEditChrome({
  addHref,
  addLabel,
  groups,
  header,
  footer,
  emptyState,
  sectionTitle,
  className = "",
}: VictoryProudMomentsEditChromeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const cardCount = groups.reduce((n, g) => n + g.cards.length, 0);
  const showEditToggle = cardCount > 0;
  const editing = isEditing && showEditToggle;

  const toolbar = (
    <div className={`${toolbarRowClass} mt-4`}>
      <Link href={addHref} className={`${vrAccentLink} inline-flex min-h-11 items-center`}>
        {addLabel}
      </Link>
      {showEditToggle ? (
        <button
          type="button"
          className={modeToggleClass}
          aria-pressed={editing}
          onClick={() => setIsEditing((on) => !on)}
        >
          {editing ? "Done Editing Proud Moments" : "Edit a Proud Moment"}
        </button>
      ) : null}
    </div>
  );

  const list = showEditToggle ? (
    <CardGroups groups={groups} showEditingControls={editing} footer={footer} />
  ) : (
    emptyState
  );

  const listBlock = sectionTitle && showEditToggle ? (
    <div className="mt-10">
      <VictoryRoomSectionShell title={sectionTitle}>{list}</VictoryRoomSectionShell>
    </div>
  ) : (
    list
  );

  return (
    <div className={className}>
      {header ? (
        <div className="mt-8 flex flex-col items-center text-center sm:items-start sm:text-left">
          {header}
          {toolbar}
        </div>
      ) : (
        toolbar
      )}
      {listBlock}
    </div>
  );
}

function CardGroups({
  groups,
  showEditingControls,
  footer,
}: {
  groups: VictoryProudMomentCardGroup[];
  showEditingControls: boolean;
  footer?: ReactNode;
}) {
  const hasHeadings = groups.some((g) => Boolean(g.heading));

  function renderCards(cards: VictoryProudMomentCardInput[], listClassName: string) {
    return (
      <ul className={listClassName}>
        {cards.map((card) => (
          <li key={card.winId}>
            <VictoryWinCard {...card} showEditingControls={showEditingControls} />
          </li>
        ))}
      </ul>
    );
  }

  if (!hasHeadings) {
    return (
      <>
        {groups.map((g) => (
          <div key={g.key}>{renderCards(g.cards, "mt-8 space-y-4")}</div>
        ))}
        {footer}
      </>
    );
  }

  return (
    <div className="mt-8 space-y-10">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={g.headingId}>
          {g.heading ? (
            <h2
              id={g.headingId}
              className="text-sm font-semibold uppercase tracking-[0.14em] text-stone-400"
            >
              {g.heading}
            </h2>
          ) : null}
          {renderCards(g.cards, "mt-4 space-y-4")}
        </section>
      ))}
      {footer}
    </div>
  );
}
