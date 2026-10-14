import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import {
  isPersonalVideoToken,
  type PersonalVideoStatus,
  watchPathForStatus,
} from "@/lib/personal-videos/personal-video";

export type PersonalVideoRecord = {
  id: string;
  publicToken: string;
  vimeoVideoId: string;
  status: PersonalVideoStatus;
  createdAt: string;
  watchPath: string | null;
};

type Row = {
  id: string;
  public_token: string;
  vimeo_video_id: string;
  status: string;
  created_at: string;
};

function asRecord(row: Row): PersonalVideoRecord | null {
  if (
    row.status !== "uploading" &&
    row.status !== "processing" &&
    row.status !== "ready" &&
    row.status !== "failed"
  ) {
    return null;
  }
  return {
    id: row.id,
    publicToken: row.public_token,
    vimeoVideoId: row.vimeo_video_id,
    status: row.status,
    createdAt: row.created_at,
    watchPath: watchPathForStatus(row.public_token, row.status),
  };
}

export async function insertPersonalVideo(args: {
  publicToken: string;
  vimeoVideoId: string;
}): Promise<PersonalVideoRecord> {
  const { data, error } = await supabaseServer
    .from("personal_videos")
    .insert({
      public_token: args.publicToken,
      vimeo_video_id: args.vimeoVideoId,
      status: "uploading",
    })
    .select("id, public_token, vimeo_video_id, status, created_at")
    .single();
  if (error || !data) throw new Error("personal_video_save_failed");
  const record = asRecord(data as Row);
  if (!record) throw new Error("personal_video_save_failed");
  return record;
}

export async function listPersonalVideos(): Promise<PersonalVideoRecord[]> {
  const { data, error } = await supabaseServer
    .from("personal_videos")
    .select("id, public_token, vimeo_video_id, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("personal_video_list_failed");
  return (data ?? []).map((row) => asRecord(row as Row)).filter((row): row is PersonalVideoRecord => row != null);
}

export async function getPersonalVideo(id: string): Promise<PersonalVideoRecord | null> {
  const { data, error } = await supabaseServer
    .from("personal_videos")
    .select("id, public_token, vimeo_video_id, status, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("personal_video_load_failed");
  return data ? asRecord(data as Row) : null;
}

export async function getPersonalVideoByToken(token: string): Promise<PersonalVideoRecord | null> {
  if (!isPersonalVideoToken(token)) return null;
  const { data, error } = await supabaseServer
    .from("personal_videos")
    .select("id, public_token, vimeo_video_id, status, created_at")
    .eq("public_token", token)
    .maybeSingle();
  if (error) throw new Error("personal_video_load_failed");
  return data ? asRecord(data as Row) : null;
}

export async function updatePersonalVideoStatus(
  id: string,
  status: PersonalVideoStatus
): Promise<PersonalVideoRecord | null> {
  const { data, error } = await supabaseServer
    .from("personal_videos")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, public_token, vimeo_video_id, status, created_at")
    .maybeSingle();
  if (error) throw new Error("personal_video_update_failed");
  return data ? asRecord(data as Row) : null;
}

export async function deletePersonalVideoRow(id: string): Promise<void> {
  const { error } = await supabaseServer.from("personal_videos").delete().eq("id", id);
  if (error) throw new Error("personal_video_delete_failed");
}
