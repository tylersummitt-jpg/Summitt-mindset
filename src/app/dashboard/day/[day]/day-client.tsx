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

export default function DayClient({
  dayNumber,
  promptId,
  coachNote,
  actionItem,
  reflectionPrompt,
  video,
}: Props) {
  // ----------------------------
  // JOURNAL STATE
  // ----------------------------
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ----------------------------
  // LOAD EXISTING JOURNAL
  // ----------------------------
  useEffect(() => {
    async function loadJournal() {
      try {
        const res = await fetch(`/api/journal?day=${dayNumber}`, {
          credentials: "include",
        });
        const data = await res.json();
        setContent(data.content ?? "");
      } catch (err) {
        console.error("Failed to load journal", err);
      } finally {
        setLoading(false);
      }
    }

    loadJournal();
  }, [dayNumber]);

  // ----------------------------
  // SAVE JOURNAL (AUTHORITATIVE)
  // ----------------------------
  async function saveJournal(value: string) {
    try {
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
    } catch (err) {
      console.error("Failed to save journal", err);
    }
  }

  // ----------------------------
  // HANDLE TYPING (DEBOUNCED)
  // ----------------------------
  function handleChange(value: string) {
    setContent(value);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveJournal(value);
    }, 800);
  }

  // ----------------------------
  // FINAL SAVE (ON COMPLETE)
  // ----------------------------
  async function handleFinalSave() {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    await saveJournal(content);
  }

  // ----------------------------
  // LOADING STATE
  // ----------------------------
  if (loading) {
    return <p className="text-sm text-gray-500">Loading reflection…</p>;
  }

  return (
    <div className="space-y-10">
      {/* 🧠 COACH PAT */}
      <section className="rounded-lg border border-gray-200 bg-gray-50 p-6">
        <p className="text-sm font-semibold text-gray-700 mb-2">
          A Note from Coach Pat
        </p>
        <p className="text-gray-800 leading-relaxed whitespace-pre-line">
          {coachNote}
        </p>
      </section>

      {/* ✅ DAILY PRACTICE */}
      <section className="rounded-lg border p-6">
        <p className="text-sm font-semibold text-gray-700 mb-2">
          Today’s Practice
        </p>
        <p className="text-gray-900 leading-relaxed whitespace-pre-line">
          {actionItem}
        </p>
      </section>

      {/* ✍️ REFLECTION */}
      <section>
        <p className="text-sm font-semibold text-gray-700 mb-2">
          Reflection
        </p>

        <p className="text-gray-800 mb-3">{reflectionPrompt}</p>

        <textarea
          className="w-full border rounded-md p-3 text-sm"
          rows={6}
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Write one honest sentence…"
        />
      </section>

      {/* 🎥 OPTIONAL FILM STUDY */}
      {video?.vimeo_id && (
        <section className="rounded-lg border p-6">
          <p className="text-sm font-semibold text-gray-700 mb-2">
            Optional Film Study
          </p>

          {video.title && (
            <p className="text-gray-800 mb-3">{video.title}</p>
          )}

          <div className="relative w-full aspect-video rounded-md overflow-hidden bg-black">
            <iframe
              src={`https://player.vimeo.com/video/${video.vimeo_id}`}
              className="absolute inset-0 w-full h-full"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
            />
          </div>

          <p className="text-gray-500 text-sm mt-3">
            Optional. Never required to complete today.
          </p>
        </section>
      )}

      {/* ✅ COMPLETE DAY */}
      <DayCompleteButton
        dayNumber={dayNumber}
        onBeforeComplete={handleFinalSave}
        videoIdShown={video?.id ?? null}
      />
    </div>
  );
}
