"use client";

import { useEffect, useRef, useState } from "react";
import DayCompleteButton from "@/components/day-complete-button";

type Props = {
  dayNumber: number;
  promptId: string;

  coachNote: string;
  coachNoteDay: number;

  actionItem: string;
  reflectionPrompt: string;
  canonicalCurrentDay: number;

  video?: {
    id: string;
    vimeo_id?: string | null;
    title?: string | null;
  };
};

type CoachMessage = {
  role: "user" | "coach";
  content: string;
};

type CoachPatDailyResponse =
  | { ok: true; note: string }
  | { ok: false; reason?: string; error?: string };

/**
 * ======================================================
 * Day Client
 * ======================================================
 *
 * Visual rules:
 * - Calm, premium cards
 * - Use design tokens (bg/surface/border/muted/brand)
 * - No “loud” colors
 * - Orange only as subtle accent
 *
 * Behavioral rules:
 * - Past days read-only
 * - Today is the only completable day
 * - Completion is calm (no fireworks)
 */

export default function DayClient({
  dayNumber,
  promptId,
  coachNote,
  coachNoteDay,
  actionItem,
  reflectionPrompt,
  canonicalCurrentDay,
  video,
}: Props) {
  const isPastDay = dayNumber < canonicalCurrentDay;
  const isCurrentDay = dayNumber === canonicalCurrentDay;

  // ======================================================
  // Coach Pat Note (client-side fetch)
  // ======================================================
  const [dailyCoachNote, setDailyCoachNote] = useState<string>(coachNote || "");
  const [coachNoteLoading, setCoachNoteLoading] = useState(false);

  useEffect(() => {
    // Today only.
    if (!isCurrentDay) return;

    let cancelled = false;

    async function loadCoachPatNote() {
      try {
        setCoachNoteLoading(true);

        const res = await fetch(`/api/coach-pat/daily?day=${coachNoteDay}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        const data = (await res.json()) as CoachPatDailyResponse;

        console.log("[Coach Pat daily] status:", res.status);
        console.log("[Coach Pat daily] data:", data);

        if (cancelled) return;

        if (res.ok && data?.ok === true && typeof data.note === "string") {
          setDailyCoachNote(data.note);
        } else {
          setDailyCoachNote("");
        }
      } catch (err) {
        console.error("Failed to fetch Coach Pat note:", err);
        if (!cancelled) setDailyCoachNote("");
      } finally {
        if (!cancelled) setCoachNoteLoading(false);
      }
    }

    loadCoachPatNote();

    return () => {
      cancelled = true;
    };
  }, [isCurrentDay, coachNoteDay]);

  // ----------------------------
  // Journal State
  // ----------------------------
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ----------------------------
  // Completion State (UI-only)
  // ----------------------------
  const [optimisticCompleted, setOptimisticCompleted] = useState(false);

  // ----------------------------
  // Coach Conversation State
  // ----------------------------
  const [thread, setThread] = useState<CoachMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachUnlocked, setCoachUnlocked] = useState(false);

  // ----------------------------
  // Load Journal
  // ----------------------------
  useEffect(() => {
    async function loadJournal() {
      const res = await fetch(`/api/journal?day=${dayNumber}`, {
        credentials: "include",
      });

      const data = await res.json();
      setContent(data.content ?? "");
      setLoading(false);
    }

    loadJournal();
  }, [dayNumber]);

  // ----------------------------
  // Save Journal
  // ----------------------------
  async function saveJournal(value: string) {
    await fetch("/api/journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        day: dayNumber,
        content: value,
        promptId,
        reflectionPrompt,
        actionItem,
        source: "app",
      }),
    });
  }

  function handleChange(value: string) {
    if (isPastDay) return;

    setContent(value);

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(() => {
      saveJournal(value);
    }, 800);
  }

  async function handleFinalSave() {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    await saveJournal(content);
  }

  // ----------------------------
  // After Completion → Coach Responds
  // ----------------------------
  async function generateCoachReplyFromJournal() {
    if (!content.trim()) return;

    setCoachLoading(true);

    const res = await fetch("/api/coach-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        day: dayNumber,
        message: content.trim(),
      }),
    });

    const data = await res.json();

    if (data?.ok) {
      setThread(data.thread);
      setCoachUnlocked(true);
    }

    setCoachLoading(false);
  }

  // ----------------------------
  // Follow-up Reply
  // ----------------------------
  async function sendChatMessage() {
    if (!chatInput.trim()) return;

    const userMessage = chatInput.trim();
    setChatInput("");
    setCoachLoading(true);

    const res = await fetch("/api/coach-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        day: dayNumber,
        message: userMessage,
      }),
    });

    const data = await res.json();

    if (data?.ok) {
      setThread(data.thread);
      setCoachUnlocked(true);
    }

    setCoachLoading(false);
  }

  if (loading) return <p>Loading…</p>;

  // ======================================================
  // FINAL COMPLETION TRUTH
  // ======================================================
  const completed = isPastDay || optimisticCompleted;

  // ======================================================
  // Shared Card Styles (calm + consistent)
  // ======================================================
  const cardBase =
    "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm";

  const cardSoft =
    "rounded-2xl border border-[var(--border)] bg-[var(--brand-soft)] p-6 shadow-sm";

  return (
    <div className="space-y-10">
      {/* ======================================================
          ✅ Coach Note (today only)
         ====================================================== */}
      {!isPastDay && (
        <section className={cardSoft}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold">A Note from Coach Pat</p>
            <span className="text-xs text-[var(--muted)]">Today</span>
          </div>

          {coachNoteLoading ? (
            <p className="text-sm text-[var(--muted)]">Coach Pat is writing…</p>
          ) : dailyCoachNote.trim() ? (
            <p className="whitespace-pre-line leading-relaxed">
              {dailyCoachNote}
            </p>
          ) : (
            <p className="text-sm text-[var(--muted)] italic">
              (No note returned — check console logs.)
            </p>
          )}
        </section>
      )}

      {/* ======================================================
          ✅ Daily Practice
         ====================================================== */}
      <section className={cardBase}>
        <p className="text-sm font-semibold mb-3">
          {isPastDay ? "Practice" : "Today’s Practice"}
        </p>
        <p className="whitespace-pre-line leading-relaxed">{actionItem}</p>
      </section>

      {/* ======================================================
          ✅ Reflection
         ====================================================== */}
      <section className="space-y-3">
        <p className="text-sm font-semibold">Reflection</p>
        <p className="text-[var(--muted)]">{reflectionPrompt}</p>

        <textarea
          className={[
            "w-full border border-[var(--border)] rounded-xl p-4 text-sm bg-[var(--surface)]",
            "focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-transparent",
            completed ? "bg-[var(--bg)] text-[var(--muted)]" : "",
          ].join(" ")}
          rows={6}
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Write one honest sentence…"
          readOnly={completed}
        />

        {completed && (
          <p className="text-xs text-[var(--muted)]">
            This day is complete and read-only.
          </p>
        )}
      </section>

      {/* ======================================================
          ✅ COMPLETE BUTTON (Only on current day)
         ====================================================== */}
      {!completed && isCurrentDay && (
        <DayCompleteButton
          dayNumber={dayNumber}
          onBeforeComplete={handleFinalSave}
          onAfterComplete={async () => {
            // 1) Generate coach reply
            await generateCoachReplyFromJournal();

            // 2) Optimistically lock UI immediately
            setOptimisticCompleted(true);
          }}
          videoIdShown={video?.id ?? null}
        />
      )}

      {/* ======================================================
          ✅ Calm Completion Marker
         ====================================================== */}
      {completed && (
        <div className="text-center text-sm text-[var(--muted)]">
          ✓ This day is complete.
        </div>
      )}

      {/* ======================================================
          ✅ Coach Thread (only on current day)
         ====================================================== */}
      {isCurrentDay && coachUnlocked && (
        <section className={cardBase + " space-y-4"}>
          <p className="text-sm font-semibold">Coach Pat (optional)</p>

          <div className="space-y-3 text-sm leading-relaxed">
            {thread.map((m, i) => (
              <div
                key={i}
                className={m.role === "coach" ? "" : "italic text-[var(--muted)]"}
              >
                {m.content}
              </div>
            ))}
          </div>

          <textarea
            rows={2}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Write back if you want…"
            className={[
              "w-full border border-[var(--border)] rounded-xl p-3 text-sm bg-[var(--surface)]",
              "focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-transparent",
            ].join(" ")}
          />

          <button
            onClick={sendChatMessage}
            disabled={coachLoading}
            className="w-full rounded-md py-2 font-semibold text-white bg-[var(--text)] hover:opacity-90 disabled:opacity-60"
          >
            {coachLoading ? "Coach Pat is responding…" : "Send"}
          </button>
        </section>
      )}

      {/* ======================================================
          ✅ Optional Film Study LAST (today only)
         ====================================================== */}
      {isCurrentDay && video?.vimeo_id && (
        <section className={cardBase}>
          <p className="text-sm font-semibold mb-3">Optional Film Study</p>

          <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
            <iframe
              src={`https://player.vimeo.com/video/${video.vimeo_id}`}
              className="absolute inset-0 w-full h-full"
              allowFullScreen
            />
          </div>

          <p className="text-[var(--muted)] text-sm mt-3">
            Optional. Never required to complete today.
          </p>
        </section>
      )}
    </div>
  );
}
