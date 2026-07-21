"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

const NativeAppContext = createContext(false);

/**
 * Server-derived native iOS flag for client CTA suppression.
 * Never trust a client-parsed User-Agent as the sole enforcement layer.
 */
export function NativeAppProvider({
  isNativeSummittMindsetIos,
  children,
}: {
  isNativeSummittMindsetIos: boolean;
  children: ReactNode;
}) {
  return (
    <NativeAppContext.Provider value={isNativeSummittMindsetIos}>
      {children}
    </NativeAppContext.Provider>
  );
}

export function useIsNativeSummittMindsetIos(): boolean {
  return useContext(NativeAppContext);
}
