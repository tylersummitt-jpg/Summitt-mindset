// src/app/sign-in/[[...sign-in]]/page.tsx
"use client";
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <SignIn />
    </div>
  );
}
