/**
 * SMS Preferences UI (Account → Text check-ins). Defaults off until staging QA passes.
 */

export function isSmsPrefsUiEnabled(): boolean {
  return process.env.SMS_PREFS_UI_ENABLED === "true";
}
