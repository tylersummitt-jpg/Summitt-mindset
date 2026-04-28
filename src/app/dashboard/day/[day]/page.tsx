import { redirect } from "next/navigation";

/** PR7: legacy day-by-day practice surface removed; links still land safely on the home dashboard. */
export default function DashboardDayRedirectPage() {
  redirect("/dashboard");
}
