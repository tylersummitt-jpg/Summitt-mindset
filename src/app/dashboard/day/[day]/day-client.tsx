"use client";

import { useEffect, useRef, useState } from "react";
import DayCompleteButton from "@/components/day-complete-button";

type Props = {
  dayNumber: number;
  promptId: string;
  coachNote: string;
  actionItem: string;
  reflectionPrompt: string;
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

export default function DayClient({
  dayNumber,
  promptId,
  coachNote,
  actionItem,
  reflectionPrompt,
  video,
}: Props) {
  // ----------------------------
  // Journal State
  // ----------------------------
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ----------------------------
  // Completion State ✅ NEW
  // ----------------------------
  const [completed, setCompleted] = useState(false);

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

      // ✅ Mark day completed so button disappears forever
      setCompleted(true);
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

  return (
    <div className="space-y-10">
      {/* ✅ Coach Note */}
      <section className="rounded-lg border bg-gray-50 p-6">
        <p className="text-sm font-semibold mb-2">A Note from Coach Pat</p>
        <p className="whitespace-pre-line">{coachNote}</p>
      </section>

      {/* ✅ Daily Practice */}
      <section className="rounded-lg border p-6">
        <p className="text-sm font-semibold mb-2">Today’s Practice</p>
        <p className="whitespace-pre-line">{actionItem}</p>
      </section>

      {/* ✅ Reflection */}
      <section>
        <p className="text-sm font-semibold mb-2">Reflection</p>
        <p className="mb-3">{reflectionPrompt}</p>

        <textarea
          className="w-full border rounded-md p-3 text-sm"
          rows={6}
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Write one honest sentence…"
        />
      </section>

      {/* ✅ COMPLETE BUTTON (Only Before Completion) */}
      {!completed && (
        <DayCompleteButton
          dayNumber={dayNumber}
          onBeforeComplete={handleFinalSave}
          onAfterComplete={generateCoachReplyFromJournal}
          videoIdShown={video?.id ?? null}
        />
      )}

      {/* ✅ Calm Completion Marker */}
      {completed && (
        <div className="text-center text-sm text-gray-500">
          ✓ Today’s practice is complete.
        </div>
      )}

      {/* ✅ Coach Thread */}
      {coachUnlocked && (
        <section className="border rounded-lg p-6 space-y-4">
          <p className="text-sm font-semibold">Coach Pat (optional)</p>

          <div className="space-y-3 text-sm">
            {thread.map((m, i) => (
              <div
                key={i}
                className={m.role === "coach" ? "" : "italic text-gray-600"}
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
            className="w-full border rounded-md p-2 text-sm"
          />

          <button
            onClick={sendChatMessage}
            disabled={coachLoading}
            className="w-full bg-black text-white rounded-md py-2 font-semibold"
          >
            {coachLoading ? "Coach Pat is responding…" : "Send"}
          </button>
        </section>
      )}

      {/* ✅ Optional Film Study LAST */}
      {video?.vimeo_id && (
        <section className="rounded-lg border p-6">
          <p className="text-sm font-semibold mb-2">Optional Film Study</p>

          <div className="relative w-full aspect-video rounded-md overflow-hidden bg-black">
            <iframe
              src={`https://player.vimeo.com/video/${video.vimeo_id}`}
              className="absolute inset-0 w-full h-full"
              allowFullScreen
            />
          </div>

          <p className="text-gray-500 text-sm mt-3">
            Optional. Never required to complete today.
          </p>
        </section>
      )}
    </div>
  );
}
