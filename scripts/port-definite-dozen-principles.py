#!/usr/bin/env python3
"""Map archived Definite Dozen principles 2–12 into curated Programs curriculum.

Reads data/learning/source and writes data/learning/curriculum plus public copies.
Does not modify the archive.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/learning/source/definite_dozen"
PROGRAM = json.loads((SOURCE / "program.json").read_text())
MEDIA = SOURCE / "media"
PUBLIC = ROOT / "public/learning/definite-dozen"
OUT = ROOT / "data/learning/curriculum/definite-dozen"

PUBLIC.mkdir(parents=True, exist_ok=True)

SLUGS = {
    "dd_mp_03": "take-full-responsibility",
    "dd_mp_04": "develop-and-demonstrate-loyalty",
    "dd_mp_05": "learn-to-be-a-great-communicator",
    "dd_mp_06": "discipline-yourself-so-no-one-else-has-to",
    "dd_mp_07": "make-hard-work-your-passion",
    "dd_mp_08": "dont-just-work-hard-work-smart",
    "dd_mp_09": "put-the-team-before-yourself",
    "dd_mp_10": "make-winning-an-attitude",
    "dd_mp_11": "be-a-competitor",
    "dd_mp_12": "change-is-a-must",
    "dd_mp_13": "handle-success-like-you-handle-failure",
}

REPORT: dict[str, list[str]] = {
    "unmatched_videos": [],
    "matched_videos": [],
    "flags": [],
    "images": [],
}


def clean(text: str | None) -> str:
    if not text:
        return ""
    text = (
        text.replace("\u202f", " ")
        .replace("\u00a0", " ")
        .replace("\u200b", "")
        .replace("\ufeff", "")
    )
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", clean(text)).strip()


def slug(text: str, limit: int = 48) -> str:
    value = re.sub(r"[^a-z0-9]+", "_", norm(text).lower()).strip("_")
    return (value or "item")[:limit].strip("_") or "item"


def is_chrome(text: str) -> bool:
    value = norm(text)
    if not value:
        return True
    low = value.lower()
    if re.match(r"^\d+\s+of\s+\d+\b", low):
        return True
    if low in {
        "continue",
        "play video",
        "mute",
        "start over",
        "start again",
        "replay",
        "continued",
        "resume lesson",
    }:
        return True
    if "transcript.pdf" in low or re.search(r"\b\d+(\.\d+)?\s*kb\b", low):
        return True
    if "complete the content above" in low:
        return True
    if "close it before opening" in low or "close this lesson" in low:
        return True
    if "certificate" in low and ("final exam" in low or "earn your certificate" in low):
        return True
    if re.match(r"^[\d/]+\s+cards correct\b", low):
        return True
    if low.startswith("quiz results"):
        return True
    if "play loaded:" in low or "remaining time" in low:
        return True
    if low in {"start", "submit", "try again", "take again"}:
        return True
    return False


def is_workbook_cue(text: str) -> bool:
    low = norm(text).lower()
    return "workbook" in low and "reflect" in low


def strip_workbook_sentences(text: str) -> str:
    paragraphs = []
    for paragraph in text.split("\n\n"):
        sentences = re.split(r"(?<=[.!?])\s+", paragraph.strip())
        kept = [sentence for sentence in sentences if "workbook" not in sentence.lower()]
        joined = " ".join(kept).strip()
        if joined:
            paragraphs.append(joined)
    return "\n\n".join(paragraphs)


def polish_blocks(blocks: list[dict]) -> None:
    has_sort = any(block.get("type") == "sort" for block in blocks)
    stack = re.compile(r"stack of cards|sort the cards|\bdrag\b", re.I)
    kept: list[dict] = []
    for index, block in enumerate(blocks):
        if block.get("type") == "markdown":
            text = strip_workbook_sentences(strip_obsolete(block.get("markdown") or ""))
            neighbor_titles = set()
            for neighbor in (blocks[index - 1 : index] + blocks[index + 1 : index + 2]):
                for section in neighbor.get("sections") or []:
                    neighbor_titles.add(norm(section.get("title") or "").lower().rstrip(".!?"))
            if neighbor_titles:
                parts = [
                    part
                    for part in text.split("\n\n")
                    if norm(part).lower().rstrip(".!?") not in neighbor_titles
                ]
                text = "\n\n".join(parts).strip()
            if has_sort:
                parts = [part for part in text.split("\n\n") if part.strip() and not stack.search(part)]
                text = "\n\n".join(parts).strip()
            if text:
                kept.append({**block, "markdown": text})
            continue
        if block.get("type") == "reflection":
            prompt = strip_workbook_sentences(strip_obsolete(block.get("prompt") or ""))
            if prompt:
                kept.append({**block, "prompt": prompt})
            continue
        kept.append(block)
    blocks[:] = kept


def strip_obsolete(text: str) -> str:
    text = re.sub(
        r"Please remember to close it before opening another lesson\.?\s*",
        "",
        text,
        flags=re.I,
    )
    text = re.sub(
        r"Similar questions will appear on the final exam to earn your certificate\.?\s*",
        "",
        text,
        flags=re.I,
    )
    text = re.sub(
        r"You might also save this response in your workbook\.?\s*",
        "",
        text,
        flags=re.I,
    )
    return clean(text)


def question_type(raw: str | None) -> str:
    value = (raw or "").lower()
    if value in {"multiple_response", "multiple_choice", "multi_choice"}:
        return "multiple_choice"
    return "single_choice"


def minimum_correct(quiz: dict) -> int:
    questions = quiz.get("questions") or []
    count = len(questions)
    stated = quiz.get("minimum_correct")
    if isinstance(stated, int) and 1 <= stated <= count:
        return stated
    instructions = quiz.get("instructions_text") or ""
    ratio = re.search(r"(\d+)\s*/\s*(\d+)", instructions)
    if ratio:
        num, den = int(ratio.group(1)), int(ratio.group(2))
        if den > 0:
            return max(1, min(count, math.ceil(count * num / den)))
    least = re.search(r"at least\s+(\d+)", instructions, re.I)
    if least:
        return max(1, min(count, int(least.group(1))))
    percent = quiz.get("pass_percent")
    if isinstance(percent, (int, float)) and percent > 0:
        return max(1, min(count, math.ceil(count * float(percent) / 100)))
    return max(1, math.ceil(count * 2 / 3))


def existing_public_by_hash() -> dict[str, str]:
    found: dict[str, str] = {}
    if not PUBLIC.exists():
        return found
    for path in PUBLIC.iterdir():
        if not path.is_file():
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        found.setdefault(digest, f"/learning/definite-dozen/{path.name}")
    return found


HASHES = existing_public_by_hash()


def promote_image(relative: str, note: str) -> str | None:
    name = Path(relative).name
    source = MEDIA / name
    if not source.is_file():
        source = SOURCE / relative
    if not source.is_file():
        REPORT["flags"].append(f"missing media {relative}")
        return None
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest in HASHES:
        return HASHES[digest]
    dest = PUBLIC / name
    shutil.copy2(source, dest)
    url = f"/learning/definite-dozen/{name}"
    HASHES[digest] = url
    REPORT["images"].append(url)
    return url


def media_index(step: dict) -> dict[str, dict]:
    indexed: dict[str, dict] = {}
    for item in step.get("media_refs") or []:
        path = item.get("path") or ""
        indexed[path] = item
        indexed[Path(path).name] = item
    return indexed


def poster_or_screenshot(meta: dict | None) -> bool:
    if not meta:
        return False
    kind = (meta.get("kind") or "").lower()
    note = (meta.get("note") or "").lower()
    if kind in {"screenshot", "transcript", "transcript_pdf"}:
        return True
    if "video poster" in note:
        return True
    return False


def image_alt(text: str, completion: bool) -> str:
    caption = norm(text)
    if re.search(r"\.(jpe?g|png|svg|webp)$", caption, re.I):
        caption = ""
    if caption and not any(word in caption.lower() for word in ("workbook", "docebo", "poster", "transcript")):
        return caption[:180]
    return "Lesson complete" if completion else "Lesson image"


def append_unplaced_images(step: dict, blocks: list[dict]) -> None:
    used = {block["src"] for block in blocks if block.get("type") == "image"}
    for meta in step.get("media_refs") or []:
        kind = (meta.get("kind") or "").lower()
        if kind not in {"lesson_image", "source_image"}:
            continue
        if poster_or_screenshot(meta):
            continue
        ref = meta.get("path") or ""
        url = promote_image(ref, meta.get("note") or "")
        if not url or url in used:
            continue
        note = meta.get("note") or ""
        completion = completion_image(Path(ref).name, note)
        image = {"type": "image", "src": url, "alt": image_alt("", completion)}
        if completion:
            image["role"] = "completion"
        blocks.append(image)
        used.add(url)


def completion_image(name: str, note: str) -> bool:
    low = f"{name} {note}".lower()
    return "completion" in low or "you have completed" in low or "wrap_up" in low or "wrap-up" in low


def quote_parts(text: str) -> tuple[str, str | None]:
    match = re.search(r"\s+[—–-]\s+(Pat Summitt)\s*$", norm(text))
    if not match:
        return text, None
    body = norm(text)[: match.start()].strip().strip('"').strip()
    return body, match.group(1)


def first_sentence(text: str, limit: int = 90) -> str:
    value = norm(text)
    parts = re.split(r"(?<=[.!?])\s+", value, maxsplit=1)
    title = parts[0] if parts else value
    if len(title) > limit:
        title = title[: limit - 1].rstrip() + "…"
    return title or "Section"


def scenario_block(activity: dict | None) -> dict | None:
    if not activity:
        return None
    kind = (activity.get("interaction_type") or "").lower()
    if "scenario" not in kind:
        return None
    states = activity.get("states_text") or []
    choice = next(
        (state for state in states if (state.get("state_name") or "").lower() == "choice"),
        None,
    )
    if not choice:
        return None
    prompt_lines: list[str] = []
    labels: list[str] = []
    for line in clean(choice.get("text")).splitlines():
        line = line.strip()
        if not line:
            continue
        numbered = re.match(r"^\d+\.?\s+(.+)$", line)
        if numbered:
            labels.append(numbered.group(1).strip())
        elif not labels:
            prompt_lines.append(line)
    feedback: dict[str, str] = {}
    for state in states:
        name = state.get("state_name") or ""
        if name.lower().endswith("feedback"):
            label = re.sub(r"\s*feedback\s*$", "", name, flags=re.I).strip()
            feedback[norm(label).lower()] = strip_obsolete(state.get("text") or "")
    choices = []
    for label in labels:
        response = feedback.get(norm(label).lower())
        if not response:
            REPORT["flags"].append(f"scenario choice without feedback: {label}")
            return None
        choices.append({"id": slug(label, 40), "label": label, "response": response})
    if len(choices) < 2 or not prompt_lines:
        return None
    return {
        "type": "choice_prompt",
        "prompt": strip_obsolete(" ".join(prompt_lines)),
        "choices": choices,
    }


def append_card(cards: list[dict], seen: set[str], text: str, category: str) -> None:
    card_id = slug(text, 42)
    base = card_id
    suffix = 2
    while card_id in seen:
        card_id = f"{base}_{suffix}"
        suffix += 1
    seen.add(card_id)
    cards.append({"id": card_id, "text": text, "correct_category": category})


def sort_block(activity: dict | None, body_prompt: str | None, item_lines: list[str] | None = None) -> dict | None:
    if not activity:
        return None
    kind = (activity.get("interaction_type") or "").lower()
    pairs = activity.get("correct_categories") or []
    categories: list[str] = []
    cards: list[dict] = []
    seen: set[str] = set()
    if isinstance(pairs, list) and pairs and isinstance(pairs[0], dict):
        for pair in pairs:
            text = norm(str(pair.get("card") or ""))
            category = norm(str(pair.get("category") or ""))
            if not text or not category:
                continue
            if category not in categories:
                categories.append(category)
            append_card(cards, seen, text, category)
    elif "sort" in kind or "drag" in kind or body_prompt:
        skip = {
            "completion",
            "completed result",
            "incorrect placement",
            "categories",
            "cards in encounter order",
            "choice",
        }
        for state in activity.get("states_text") or []:
            name = norm(str(state.get("state_name") or ""))
            if not name or name.lower() in skip or name.lower().endswith("feedback"):
                continue
            parts = [norm(part) for part in re.split(r";|\n", state.get("text") or "") if norm(part)]
            parts = [part for part in parts if not re.match(r"^[\d/]+\s+cards correct", part, re.I)]
            if len(parts) < 2:
                continue
            if name not in categories:
                categories.append(name)
            for part in parts:
                if "—" in part and part.split("—")[-1].strip() in categories:
                    continue
                append_card(cards, seen, part, name)
    if len(cards) < 2:
        for line in item_lines or []:
            pieces = re.split(r"\s+[—–-]\s+", line, maxsplit=1)
            if len(pieces) != 2:
                continue
            text, category = norm(pieces[0]), norm(pieces[1])
            if not text or not category:
                continue
            if category not in categories:
                categories.append(category)
            append_card(cards, seen, text, category)
    if len(cards) < 2 or len(categories) < 2:
        return None
    prompt = strip_obsolete(body_prompt or activity.get("instructions_text") or "")
    prompt = re.sub(r"\bstack of cards\b", "items", prompt, flags=re.I)
    if not prompt or re.search(r"stack of cards|\bdrag\b|sort the cards", prompt, re.I):
        prompt = (
            "You'll see one item at a time. "
            f"Decide whether it belongs with “{categories[0]}” or “{categories[1]}.”"
        )
    return {"type": "sort", "prompt": prompt, "categories": categories, "cards": cards}


def quiz_block(quiz: dict | None, step_id: str) -> dict | None:
    if not quiz:
        return None
    questions = []
    for index, question in enumerate(quiz.get("questions") or [], start=1):
        choices = []
        correct = [str(item) for item in (question.get("correct_choice_ids") or [])]
        for choice in question.get("choices") or []:
            choice_id = str(choice.get("id") or "")
            text = norm(str(choice.get("text") or ""))
            if not choice_id or not text:
                continue
            choices.append({"id": choice_id, "text": text})
            if choice.get("is_correct") and choice_id not in correct:
                correct.append(choice_id)
        correct = [item for item in correct if any(choice["id"] == item for choice in choices)]
        prompt = norm(str(question.get("question") or question.get("prompt") or ""))
        question_id = str(question.get("question_id") or f"{step_id}_q{index:02d}")
        if not prompt or not question_id or not choices or not correct:
            REPORT["flags"].append(f"dropped incomplete question {question_id or prompt[:40]}")
            continue
        questions.append(
            {
                "question_id": question_id,
                "prompt": prompt,
                "question_type": question_type(question.get("question_type")),
                "choices": choices,
                "correct_choice_ids": correct,
            }
        )
    if not questions:
        return None
    payload = {"questions": questions, "minimum_correct": None, "instructions_text": quiz.get("instructions_text"), "pass_percent": quiz.get("pass_percent")}
    payload["minimum_correct"] = minimum_correct({**quiz, "questions": questions})
    return {
        "type": "quiz",
        "minimum_correct": payload["minimum_correct"],
        "questions": questions,
    }


def video_block(step: dict) -> dict | None:
    video = step.get("video") or {}
    title = norm(video.get("source_visible_title") or "")
    speaker = norm(video.get("source_speaker") or "")
    if not title or not speaker:
        return None
    match = video.get("film_room_match") or {}
    status = str(match.get("status") or "")
    vimeo = match.get("matched_vimeo_video_id") or video.get("source_vimeo_id")
    verified = status.startswith("matched") and isinstance(vimeo, (str, int)) and str(vimeo).isdigit()
    if verified:
        REPORT["matched_videos"].append(f"{step['step_id']} {vimeo} {speaker} — {title}")
        vimeo_id: str | None = str(vimeo)
    else:
        REPORT["unmatched_videos"].append(f"{step['step_id']} {speaker} — {title}")
        vimeo_id = None
    return {
        "type": "video",
        "vimeo_video_id": vimeo_id,
        "visible_title": title,
        "speaker": speaker,
    }


def description_for(program: dict, learner_steps: list[dict]) -> str:
    overview = next(
        (
            step
            for step in program["steps"]
            if "overview" in (step.get("source_title") or "").lower()
        ),
        None,
    )
    if overview:
        text = clean(overview.get("exact_visible_copy") or "")
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        kept = []
        for line in lines:
            if re.match(r"^\d+\.\d+\s+\|", line):
                break
            if line.lower() in {"resume lesson"}:
                continue
            if line == program.get("source_title"):
                continue
            kept.append(line)
        paragraph = norm(" ".join(kept))
        if len(paragraph) > 80:
            return paragraph
    for step in learner_steps:
        for block in step.get("body_blocks") or []:
            text = strip_obsolete(block.get("text") or "")
            if block.get("type") == "paragraph" and len(norm(text)) > 80 and not is_chrome(text):
                return norm(text)
    return program["source_title"]


def is_overview(step: dict) -> bool:
    title = step.get("source_title") or ""
    return step.get("step_type") == "text" and "overview" in title.lower()


def chunk_title(name: str, text: str) -> str:
    if "—" in text:
        head = text.split("—", 1)[0].strip()
        if 0 < len(head) < 90:
            return head
    cleaned = re.sub(r"^(process_step_\d+_|timeline_\d+_?)", "", name).replace("_", " ").strip()
    if cleaned and not cleaned.isdigit():
        return cleaned[:1].upper() + cleaned[1:]
    return text[:80]


def absorb_activity_chunks(step: dict, blocks: list[dict]) -> None:
    states = (step.get("activity") or {}).get("states_text") or []
    if not states:
        return
    existing = "\n".join(
        block.get("markdown", "")
        + "\n".join(
            f"{section.get('title','')}\n{section.get('body','')}"
            for section in block.get("sections") or []
        )
        for block in blocks
        if block.get("type") in {"markdown", "sections"}
    )
    sections: list[dict] = []
    flash_front = None
    for state in states:
        name = str(state.get("state_name") or "")
        text = norm(str(state.get("text") or ""))
        if not text or text in existing:
            continue
        lower = name.lower()
        if lower.startswith("process_step") or lower.startswith("timeline_"):
            title = chunk_title(name, text)
            sections.append({"id": slug(title, 40) or f"section_{len(sections)+1}", "title": title, "body": text})
        elif "flashcard_front" in lower:
            flash_front = text
        elif "flashcard_back" in lower and flash_front:
            title = flash_front if len(flash_front) <= 140 else flash_front[:137].rstrip() + "..."
            body = text if len(flash_front) <= 140 else f"{flash_front}\n\n{text}"
            sections.append(
                {"id": slug(title, 40) or f"section_{len(sections)+1}", "title": title, "body": body}
            )
            flash_front = None
        elif lower in {"scenario", "process_summary"} or lower.startswith("scenario_"):
            blocks.append({"type": "markdown", "markdown": text})
            existing += "\n" + text
    if len(sections) >= 2 and not any(block.get("type") == "sections" for block in blocks):
        blocks.append({"type": "sections", "sections": sections})


def build_step(step: dict, group: str) -> dict:
    indexed = media_index(step)
    blocks: list[dict] = []
    markdown: list[str] = []
    pending_questions: list[str] = []
    video_used = False
    sort_prompt = None
    sort_items: list[str] = []
    reflection_index = 0
    used_quotes: set[str] = set()

    def flush_markdown() -> None:
        nonlocal markdown
        text = strip_obsolete("\n\n".join(part for part in markdown if part.strip()))
        markdown = []
        if text:
            blocks.append({"type": "markdown", "markdown": text})

    def add_reflection(prompt: str) -> None:
        nonlocal reflection_index
        prompt = strip_obsolete(prompt)
        if not prompt or is_chrome(prompt) or is_workbook_cue(prompt):
            return
        chunks = [prompt]
        if len(prompt) > 1000:
            chunks = []
            current = ""
            for sentence in re.split(r"(?<=[.!?])\s+", prompt):
                if current and len(current) + len(sentence) + 1 > 1000:
                    chunks.append(current)
                    current = sentence
                else:
                    current = f"{current} {sentence}".strip()
            if current:
                chunks.append(current)
        for chunk in chunks:
            if len(chunk) > 1000:
                REPORT["flags"].append(f"{step['step_id']} reflection still over 1000 chars")
                chunk = chunk[:1000].rstrip()
            reflection_index += 1
            blocks.append(
                {
                    "type": "reflection",
                    "question_id": f"{step['step_id']}_reflection_{reflection_index:02d}",
                    "prompt": chunk,
                }
            )

    def flush_questions() -> None:
        nonlocal pending_questions
        for prompt in pending_questions:
            pieces = [part.strip() for part in re.split(r"\n+", prompt) if part.strip()]
            questions = [part for part in pieces if "?" in part]
            targets = questions or pieces
            for target in targets:
                add_reflection(target)
        pending_questions = []

    video = video_block(step)

    for body in step.get("body_blocks") or []:
        kind = body.get("type")
        text = clean(body.get("text") or "")
        items = [clean(str(item)) for item in (body.get("items") or []) if clean(str(item))]

        if kind == "reflection":
            flush_markdown()
            add_reflection(text)
            continue

        if kind in {"paragraph", "heading", "instruction", "callout", "summary"}:
            if is_workbook_cue(text):
                flush_markdown()
                flush_questions()
                continue
            if is_chrome(text):
                if "play video" in norm(text).lower() and video and not video_used:
                    flush_markdown()
                    blocks.append(video)
                    video_used = True
                continue
            if video and norm(text) == norm(video["visible_title"]):
                if not video_used:
                    flush_markdown()
                    blocks.append(video)
                    video_used = True
                continue
            if "?" in text and (
                step.get("step_type") in {"reflection", "reflection_completion", "activity"}
                or "reflect" in text.lower()
            ):
                pending_questions.append(text)
                continue
            if pending_questions and "?" not in text:
                flush_questions()
            attribution = None
            if kind != "heading":
                text, attribution = quote_parts(text)
            markdown.append(text)
            if attribution:
                markdown.append(f"— {attribution}")
            continue

        if kind == "quote":
            flush_questions()
            body_text, attribution = quote_parts(text)
            if norm(body_text) in used_quotes:
                continue
            markdown.append(body_text)
            if attribution:
                markdown.append(f"— {attribution}")
            else:
                markdown.append("— Pat Summitt") if "pat summitt" in text.lower() else None
            continue

        if kind in {"list", "ordered_list", "numbered_list"}:
            flush_questions()
            for item in items:
                if not is_chrome(item):
                    markdown.append(item)
            continue

        if kind == "checklist":
            flush_markdown()
            flush_questions()
            lines = [text] if text and not is_chrome(text) else []
            lines.extend(f"- {item}" for item in items)
            if lines:
                blocks.append({"type": "markdown", "markdown": "\n\n".join(lines)})
            continue

        if kind == "table":
            flush_markdown()
            flush_questions()
            lines = [text] if text else []
            lines.extend(item.replace(" | ", " — ") for item in items)
            if lines:
                blocks.append({"type": "markdown", "markdown": "\n\n".join(lines)})
            continue

        if kind == "image":
            flush_markdown()
            flush_questions()
            ref = body.get("image_ref") or ""
            if not ref:
                if text and not is_chrome(text):
                    markdown.append(text)
                continue
            meta = indexed.get(ref) or indexed.get(Path(ref).name)
            if poster_or_screenshot(meta):
                continue
            url = promote_image(ref, (meta or {}).get("note") or "")
            if not url:
                continue
            note = (meta or {}).get("note") or ""
            image = {
                "type": "image",
                "src": url,
                "alt": image_alt(text, completion_image(Path(ref).name, note)),
            }
            if completion_image(Path(ref).name, note):
                image["role"] = "completion"
            blocks.append(image)
            continue

        if kind in {"accordion", "accordion_panel", "process_step", "timeline", "flashcard", "process", "flashcards"}:
            flush_markdown()
            flush_questions()
            sections = section_from_body(kind, text, items)
            if sections:
                blocks.append({"type": "sections", "sections": sections})
            continue

        if kind == "sorting_activity":
            flush_markdown()
            flush_questions()
            sort_prompt = text or sort_prompt
            sort_items.extend(items)
            continue

        if kind in {"knowledge_check", "embedded_knowledge_check", "question", "quiz_prompt"}:
            flush_markdown()
            flush_questions()
            continue

        if kind in {"completion_message", "completion"}:
            flush_markdown()
            flush_questions()
            message = strip_obsolete(text)
            message = re.sub(
                r"Please remember to close it before opening another lesson\.?\s*",
                "",
                message,
                flags=re.I,
            )
            if "congrat" in message.lower():
                message = "Congratulations! That concludes this lesson. You can revisit the completed course material at any time."
            if message:
                blocks.append({"type": "markdown", "markdown": message})
            continue

        if kind in {"video", "paragraphs", "feedback", "activity", "labeled_graphic", "sorting_categories"}:
            if kind == "labeled_graphic":
                flush_markdown()
                ref = body.get("image_ref") or ""
                meta = indexed.get(ref) or indexed.get(Path(ref).name)
                if ref and not poster_or_screenshot(meta):
                    url = promote_image(ref, (meta or {}).get("note") or text)
                    if url:
                        blocks.append(
                            {
                                "type": "image",
                                "src": url,
                                "alt": norm(text or (meta or {}).get("note") or "Diagram")[:180],
                            }
                        )
                if items:
                    blocks.append(
                        {
                            "type": "markdown",
                            "markdown": "\n\n".join([text] + items if text else items),
                        }
                    )
                continue
            if text and not is_chrome(text):
                markdown.append(text)
            for item in items:
                if not is_chrome(item):
                    markdown.append(item)
            continue

        if text and not is_chrome(text):
            markdown.append(text)

    flush_markdown()
    flush_questions()

    if video and not video_used:
        blocks.insert(0, video)

    scenario = scenario_block(step.get("activity"))
    if scenario:
        blocks.append(scenario)

    sorting = sort_block(step.get("activity"), sort_prompt, sort_items)
    if sorting:
        blocks.append(sorting)

    quiz = quiz_block(step.get("quiz"), step["step_id"])
    if quiz and not any(block.get("type") == "quiz" for block in blocks):
        if step.get("step_type") == "quiz":
            blocks = [quiz]
        else:
            blocks.append(quiz)

    absorb_activity_chunks(step, blocks)
    polish_blocks(blocks)
    append_unplaced_images(step, blocks)

    if not blocks:
        title = step.get("source_title") or step["step_id"]
        blocks = [{"type": "markdown", "markdown": title}]
        REPORT["flags"].append(f"{step['step_id']} had no portable blocks")

    built = {
        "id": step["step_id"],
        "source_step_id": step["step_id"],
        "sequence": 0,
        "title": step.get("source_title") or step["step_id"],
        "blocks": blocks,
    }
    if group:
        built["group_label"] = group
    return built


def section_from_body(kind: str, text: str, items: list[str]) -> list[dict]:
    sections = []
    if kind == "timeline":
        for index, item in enumerate(items, start=1):
            sections.append(
                {
                    "id": slug(item, 40) or f"step_{index}",
                    "title": first_sentence(item, 80),
                    "body": item,
                }
            )
        return dedupe_sections(sections)
    if kind == "flashcard" or kind == "flashcards":
        blobs = [text] if text else []
        blobs.extend(items)
        for blob in blobs:
            front = re.search(r"Front:\s*(.+?)(?:\n|Back:|$)", blob, re.I | re.S)
            back = re.search(r"Back:\s*(.+)$", blob, re.I | re.S)
            if front and back:
                sections.append(
                    {
                        "id": slug(front.group(1), 40),
                        "title": first_sentence(front.group(1), 90),
                        "body": clean(back.group(1)),
                    }
                )
            elif blob:
                sections.append(
                    {
                        "id": slug(blob, 40),
                        "title": first_sentence(blob, 80),
                        "body": blob,
                    }
                )
        return dedupe_sections(sections)
    if kind == "accordion":
        body = "\n\n".join(items) if items else text
        title = text if text and len(norm(text)) <= 120 else first_sentence(body, 80)
        if items and text and len(norm(text)) <= 120:
            body = "\n\n".join(items)
        sections.append({"id": slug(title, 40), "title": title, "body": body or title})
        return dedupe_sections(sections)
    if kind == "accordion_panel":
        title = first_sentence(text, 80)
        sections.append({"id": slug(title, 40), "title": title, "body": text})
        return dedupe_sections(sections)
    if kind in {"process_step", "process"}:
        blobs = [text] if text else []
        blobs.extend(items)
        for blob in blobs:
            if not blob:
                continue
            sections.append(
                {
                    "id": slug(blob, 40),
                    "title": first_sentence(blob, 80),
                    "body": blob,
                }
            )
        return dedupe_sections(sections)
    return []


def dedupe_sections(sections: list[dict]) -> list[dict]:
    seen: set[str] = set()
    unique = []
    for section in sections:
        if not section["title"] or not section["body"]:
            continue
        base = section["id"] or "section"
        section_id = base
        suffix = 2
        while section_id in seen:
            section_id = f"{base}_{suffix}"
            suffix += 1
        seen.add(section_id)
        section["id"] = section_id
        unique.append(section)
    return unique


def group_for(program: dict, step: dict) -> str:
    subsection = clean(step.get("source_subsection") or "")
    if subsection:
        return re.sub(r"\s+", " ", subsection).strip()
    page = step.get("source_page_number") or step.get("page_number")
    groups = ((program.get("source_navigation") or {}).get("groups")) or []
    if isinstance(page, int):
        for group in groups:
            if page in (group.get("pages") or []):
                return re.sub(r"\s+", " ", clean(group.get("source_title") or "")).strip()
    return ""


def build_program(program: dict) -> dict:
    learner = [step for step in program["steps"] if not is_overview(step)]
    steps = []
    for index, step in enumerate(learner, start=1):
        built = build_step(step, group_for(program, step))
        built["sequence"] = index
        steps.append(built)
    return {
        "id": program["mini_program_id"],
        "collection_id": "definite_dozen",
        "collection_title": "Definite Dozen",
        "title": program["source_title"],
        "description": description_for(program, learner),
        "sequence": int(program["source_sequence"]) - 1,
        "estimated_minutes": max(30, len(steps) * 3),
        "source_mini_program_id": program["mini_program_id"],
        "curriculum_version": 1,
        "steps": steps,
    }


def main() -> None:
    written = []
    for program in PROGRAM["mini_programs"]:
        mini_id = program["mini_program_id"]
        if mini_id not in SLUGS:
            continue
        if program.get("capture_status") != "complete":
            raise SystemExit(f"{mini_id} is not complete")
        curated = build_program(program)
        path = OUT / f"{mini_id}.json"
        path.write_text(json.dumps(curated, indent=2, ensure_ascii=False) + "\n")
        written.append(
            f"{mini_id} steps={len(curated['steps'])} seq={curated['sequence']} {curated['title']}"
        )
    summary = {
        "written": written,
        "matched_videos": REPORT["matched_videos"],
        "unmatched_videos": REPORT["unmatched_videos"],
        "images": REPORT["images"],
        "flags": REPORT["flags"],
    }
    (ROOT / "scripts" / "port-definite-dozen-summary.json").write_text(
        json.dumps(summary, indent=2) + "\n"
    )
    print("\n".join(written))
    print("images", len(REPORT["images"]))
    print("matched", len(REPORT["matched_videos"]), "unmatched", len(REPORT["unmatched_videos"]))
    print("flags", len(REPORT["flags"]))
    for flag in REPORT["flags"][:40]:
        print(" FLAG", flag)


if __name__ == "__main__":
    main()
