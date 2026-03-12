import { supabaseServer } from "@/lib/supabase-server";

const baseUrl = "https://summittmindset.com";

export default async function sitemap() {
  const staticPages = [
    "/",
    "/daily-practice",
    "/ask-pat-preview",
    "/about",
    "/subscribe",
    "/pat-summitt-documentary",
    "/pat-xo-documentary",
    "/the-cinderella-season-documentary",
    "/pat-summitt-espn-documentary",
    "/pat-summitt-hulu-documentary",
    "/pat-summitt-quotes",
    "/pat-summitt-quotes/discipline",
    "/pat-summitt-quotes/leadership",
    "/pat-summitt-quotes/accountability",
    "/pat-summitt-quotes/team",
    "/pat-summitt-quotes/standards",
    "/pat-summitt-best-quotes",
    "/pat-summitt-leadership-quotes",
    "/pat-summitt-leadership-principles",
    "/pat-summitt-discipline",
    "/pat-summitt-leadership",
    "/pat-summitt-accountability",
    "/pat-summitt-team-culture",
  ].map((path) => ({
    url: `${baseUrl}${path}`,
  }));

  const { data } = await supabaseServer
    .from("pat_quotes")
    .select("slug, created_at")
    .eq("active", true);

  const quotePages = (data ?? []).map((quote) => ({
    url: `${baseUrl}/pat-summitt-quotes/${quote.slug}`,
    lastModified: quote.created_at,
  }));

  return [...staticPages, ...quotePages];
}
