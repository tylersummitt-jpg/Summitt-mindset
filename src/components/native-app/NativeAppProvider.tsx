"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type { SummittMindsetPlatform } from "@/lib/native-app/platform";

const NativeAppContext = createContext(false);
const NativePlatformContext = createContext<SummittMindsetPlatform>("none");

/**
 * Server-derived native-app flag for client CTA suppression.
 * Never trust a client-parsed User-Agent as the sole enforcement layer.
 * True for iOS or Android Summitt Mindset shells.
 */
export function NativeAppProvider({
  isNativeSummittMindsetApp,
  platform = "none",
  children,
}: {
  isNativeSummittMindsetApp: boolean;
  platform?: SummittMindsetPlatform;
  children: ReactNode;
}) {
  return (
    <NativeAppContext.Provider value={isNativeSummittMindsetApp}>
      <NativePlatformContext.Provider value={platform}>
        {children}
      </NativePlatformContext.Provider>
    </NativeAppContext.Provider>
  );
}

export function useIsNativeSummittMindsetApp(): boolean {
  return useContext(NativeAppContext);
}

export function useNativeSummittMindsetPlatform(): SummittMindsetPlatform {
  return useContext(NativePlatformContext);
}
