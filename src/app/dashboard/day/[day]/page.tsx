import { redirect } from "next/navigation";
import { MEMBER_APP_HOME_PATH } from "@/lib/member-app-home-path";

/** PR7: legacy day-by-day practice surface removed; links still land safely in Victory Room. */
export default function DashboardDayRedirectPage() {
  redirect(MEMBER_APP_HOME_PATH);
}
