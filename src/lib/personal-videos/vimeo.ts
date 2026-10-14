import "server-only";

import {
  isVimeoUploadLink,
  PERSONAL_VIDEO_EMBED_DOMAIN,
  personalVideoCreateBody,
  personalVideoPrivacyOk,
  readinessFromVimeo,
  vimeoIdFromUri,
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

export async function readPersonalVimeoVideo(vimeoId: string): Promise<PersonalVideoStatus> {
  const response = await fetch(
    `https://api.vimeo.com/videos/${vimeoId}?fields=status,transcode.status,privacy.view,privacy.embed,privacy.download`,
    { headers: authHeaders(), cache: "no-store" }
  );
  if (!response.ok) throw new Error("vimeo_read_failed");
  const body = (await response.json()) as {
    status?: unknown;
    transcode?: { status?: unknown } | null;
    privacy?: { view?: unknown; embed?: unknown; download?: unknown } | null;
  };
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
