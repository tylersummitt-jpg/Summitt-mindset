import "server-only";

import {
  isVimeoUploadLink,
  PERSONAL_VIDEO_EMBED_DOMAIN,
  personalVideoCreateBody,
  personalVideoPosterOk,
  personalVideoPosterSeconds,
  personalVideoPosterStep,
  personalVideoPrivacyOk,
  readinessFromVimeo,
  vimeoIdFromUri,
  type PersonalVideoPosterPicture,
  type PersonalVideoStatus,
} from "@/lib/personal-videos/personal-video";

const ACCEPT = "application/vnd.vimeo.*+json;version=3.4";

function authHeaders(): HeadersInit {
  const token = process.env.VIMEO_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("vimeo_unavailable");
  return {
    Authorization: `Bearer ${token}`,
    Accept: ACCEPT,
  };
}

export type CreatedVimeoUpload = {
  vimeoId: string;
  uploadLink: string;
};

export async function createPersonalVimeoUpload(byteSize: number): Promise<CreatedVimeoUpload> {
  const response = await fetch("https://api.vimeo.com/me/videos", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(personalVideoCreateBody(byteSize)),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("vimeo_create_failed");
  const body = (await response.json()) as {
    uri?: unknown;
    upload?: { upload_link?: unknown };
    privacy?: { view?: unknown; embed?: unknown; download?: unknown };
  };
  const vimeoId = vimeoIdFromUri(body.uri);
  const uploadLink = body.upload?.upload_link;
  if (!vimeoId || !isVimeoUploadLink(uploadLink)) {
    if (vimeoId) await deletePersonalVimeoVideo(vimeoId).catch(() => undefined);
    throw new Error("vimeo_create_failed");
  }
  const domain = await fetch(
    `https://api.vimeo.com/videos/${vimeoId}/privacy/domains/${PERSONAL_VIDEO_EMBED_DOMAIN}`,
    { method: "PUT", headers: authHeaders(), cache: "no-store" }
  );
  if (!domain.ok) {
    await deletePersonalVimeoVideo(vimeoId).catch(() => undefined);
    throw new Error("vimeo_privacy_failed");
  }
  await fetch(`https://api.vimeo.com/videos/${vimeoId}/privacy/domains/www.summittmindset.com`, {
    method: "PUT",
    headers: authHeaders(),
    cache: "no-store",
  }).catch(() => undefined);
  const privacy = await fetch(
    `https://api.vimeo.com/videos/${vimeoId}?fields=privacy.view,privacy.embed,privacy.download`,
    { headers: authHeaders(), cache: "no-store" }
  );
  const privacyBody = privacy.ok
    ? ((await privacy.json()) as {
        privacy?: { view?: unknown; embed?: unknown; download?: unknown };
      })
    : null;
  if (!privacyBody || !personalVideoPrivacyOk(privacyBody)) {
    await deletePersonalVimeoVideo(vimeoId).catch(() => undefined);
    throw new Error("vimeo_privacy_failed");
  }
  return { vimeoId, uploadLink };
}

const POSTER_ATTEMPTS = 4;
const POSTER_RETRY_MS = 700;

type VimeoVideoBody = {
  status?: unknown;
  duration?: unknown;
  transcode?: { status?: unknown } | null;
  privacy?: { view?: unknown; embed?: unknown; download?: unknown } | null;
  pictures?: { type?: unknown; active?: unknown } | null;
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPersonalVimeoVideo(vimeoId: string): Promise<VimeoVideoBody> {
  const response = await fetch(
    `https://api.vimeo.com/videos/${vimeoId}?fields=status,duration,transcode.status,privacy.view,privacy.embed,privacy.download,pictures.type,pictures.active`,
    { headers: authHeaders(), cache: "no-store" }
  );
  if (!response.ok) throw new Error("vimeo_read_failed");
  return (await response.json()) as VimeoVideoBody;
}

async function listPersonalVideoPictures(vimeoId: string): Promise<PersonalVideoPosterPicture[] | null> {
  const response = await fetch(
    `https://api.vimeo.com/videos/${vimeoId}/pictures?fields=uri,active,type`,
    { headers: authHeaders(), cache: "no-store" }
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { data?: PersonalVideoPosterPicture[] };
  return Array.isArray(body.data) ? body.data : [];
}

/** Create or activate a frame about two seconds in. A custom active thumbnail is left unchanged. */
export async function repairPersonalVideoPoster(vimeoId: string, durationSeconds?: unknown): Promise<boolean> {
  let requested = false;
  for (let attempt = 0; attempt < POSTER_ATTEMPTS; attempt += 1) {
    const pictures = await listPersonalVideoPictures(vimeoId);
    if (!pictures) return false;
    if (personalVideoPosterStep(pictures) === "keep") return true;
    if (!requested) {
      const step = personalVideoPosterStep(pictures);
      const custom = pictures.find(
        (picture) =>
          picture.type === "custom" &&
          typeof picture.uri === "string" &&
          picture.uri.startsWith(`/videos/${vimeoId}/pictures/`)
      );
      const response =
        step === "activate" && custom && typeof custom.uri === "string"
          ? await fetch(`https://api.vimeo.com${custom.uri}`, {
              method: "PATCH",
              headers: { ...authHeaders(), "Content-Type": "application/json" },
              body: JSON.stringify({ active: true }),
              cache: "no-store",
            })
          : await fetch(`https://api.vimeo.com/videos/${vimeoId}/pictures`, {
              method: "POST",
              headers: { ...authHeaders(), "Content-Type": "application/json" },
              body: JSON.stringify({
                time: personalVideoPosterSeconds(durationSeconds),
                active: true,
              }),
              cache: "no-store",
            });
      if (!response.ok) return false;
      requested = true;
    }
    if (attempt < POSTER_ATTEMPTS - 1) await wait(POSTER_RETRY_MS);
  }
  return false;
}

export async function repairReadyPersonalVideoPosters(vimeoIds: readonly string[]): Promise<void> {
  const pending = [...vimeoIds];
  const workers = Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (pending.length > 0) {
      const vimeoId = pending.shift();
      if (!vimeoId) return;
      await repairPersonalVideoPoster(vimeoId).catch(() => false);
    }
  });
  await Promise.all(workers);
}

export async function readPersonalVimeoVideo(vimeoId: string): Promise<PersonalVideoStatus> {
  const body = await fetchPersonalVimeoVideo(vimeoId);
  if (readinessFromVimeo(body) === "ready") return "ready";
  const playable = body.transcode?.status === "complete" || body.status === "available";
  if (playable && personalVideoPrivacyOk(body) && !personalVideoPosterOk(body)) {
    const poster = await repairPersonalVideoPoster(vimeoId, body.duration).catch(() => false);
    return poster ? "ready" : "processing";
  }
  return readinessFromVimeo(body);
}

export async function deletePersonalVimeoVideo(vimeoId: string): Promise<"deleted" | "missing"> {
  const response = await fetch(`https://api.vimeo.com/videos/${vimeoId}`, {
    method: "DELETE",
    headers: authHeaders(),
    cache: "no-store",
  });
  if (response.status === 404) return "missing";
  if (!response.ok) throw new Error("vimeo_delete_failed");
  return "deleted";
}
