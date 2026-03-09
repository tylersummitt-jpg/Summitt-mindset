import { supabaseServer } from "@/lib/supabase-server";

export default async function sitemap() {
  const { data } = await supabaseServer
    .from("pat_quotes")
    .select("slug, created_at")
    .eq("active", true);

  if (!data) {
    return [];
  }

  return data.map((quote) => ({
    url: `https://summittmindset.com/pat-summitt-quotes/${quote.slug}`,
    lastModified: quote.created_at,
  }));
}
