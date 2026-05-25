"use client";

import type { ReactElement } from "react";
import { useRouter } from "next/navigation";
import {
  IdentityBuilderClient,
  EDIT_GENERATED_OPTION_LABEL,
  GENERATION_FAILURE_ESCAPE_MESSAGE,
  type IdentityBuilderInitial,
} from "@/components/IdentityBuilderClient";

export { EDIT_GENERATED_OPTION_LABEL, GENERATION_FAILURE_ESCAPE_MESSAGE };
export type IdentityClientInitial = IdentityBuilderInitial;

export default function IdentityClient(props: IdentityClientInitial = {}): ReactElement {
  const router = useRouter();

  return (
    <IdentityBuilderClient
      {...props}
      mode="onboarding"
      saveEndpoint="/api/onboarding/identity"
      backHref="/onboarding"
      continueLabel="Continue to My Current Goal →"
      onSaveSuccess={() => {
        router.push("/onboarding/commitment");
        router.refresh();
      }}
    />
  );
}
