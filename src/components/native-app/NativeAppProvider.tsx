"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

const NativeAppContext = createContext(false);

/**
 * Server-derived native-app flag for client CTA suppression.
 * Never trust a client-parsed User-Agent as the sole enforcement layer.
 * True for iOS or Android Summitt Mindset shells.
 */
export function NativeAppProvider({
  isNativeSummittMindsetApp,
  children,
}: {
  isNativeSummittMindsetApp: boolean;
  children: ReactNode;
}) {
  return (
    <NativeAppContext.Provider value={isNativeSummittMindsetApp}>
      {children}
    </NativeAppContext.Provider>
  );
}

export function useIsNativeSummittMindsetApp(): boolean {
  return useContext(NativeAppContext);
}
