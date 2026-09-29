import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signInCreateMock = vi.fn();
const prepareFirstFactorMock = vi.fn();
const signUpCreateMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: unknown;
    href: string;
  }) => <a href={href}>{children as never}</a>,
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
  useSignIn: () => ({
    isLoaded: true,
    setActive: vi.fn(),
    signIn: {
      create: signInCreateMock,
      prepareFirstFactor: prepareFirstFactorMock,
      attemptFirstFactor: vi.fn(),
    },
  }),
  useSignUp: () => ({
    isLoaded: true,
    setActive: vi.fn(),
    signUp: {
      create: signUpCreateMock,
      prepareEmailAddressVerification: vi.fn(),
      attemptEmailAddressVerification: vi.fn(),
    },
  }),
}));

vi.mock("@clerk/nextjs/errors", () => ({
  isClerkAPIResponseError: (err: unknown) =>
    Boolean(err && typeof err === "object" && "errors" in err),
}));

import AppEmailCodeSignIn from "@/components/app-sign-in/AppEmailCodeSignIn";

const MEMBER_GUIDANCE =
  "Already a member? Sign in with the same email you used for Summitt Mindset on the website.";
const SAME_EMAIL =
  "Use the same email you used for Summitt Mindset on the website.";
const CREATE_ACCOUNT = "New to Summitt Mindset? Create an account";

describe("App sign-in existing-member guidance", () => {
  beforeEach(() => {
    signInCreateMock.mockReset();
    prepareFirstFactorMock.mockReset();
    signUpCreateMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("tells existing members which email to use before Sign in", () => {
    render(<AppEmailCodeSignIn />);
    const guidance = screen.getByText(MEMBER_GUIDANCE);
    const signIn = screen.getByRole("button", { name: "Sign in" });
    const create = screen.getByRole("button", { name: CREATE_ACCOUNT });
    expect(signIn.className).toContain("bg-[var(--text)]");
    expect(create.className).not.toContain("bg-[var(--text)]");
    expect(create.className).toContain("underline");
    expect(
      screen.queryByText(
        "Sign in to your existing account or create a new account."
      )
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Create account" })).toBeNull();
    expect(
      guidance.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      signIn.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("repeats the website-email guidance on the sign-in email step", async () => {
    const user = userEvent.setup();
    render(<AppEmailCodeSignIn />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText(SAME_EMAIL)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Email" })).toBeTruthy();
  });

  it("asks an unknown email to try the website email before creating an account", async () => {
    signInCreateMock.mockRejectedValue({
      errors: [{ code: "form_identifier_not_found" }],
    });
    const user = userEvent.setup();
    render(<AppEmailCodeSignIn />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.type(
      screen.getByRole("textbox", { name: "Email" }),
      "wrong@example.com"
    );
    await user.click(
      screen.getByRole("button", { name: "Send verification code" })
    );

    expect(
      await screen.findByText(
        "We couldn't find a Summitt Mindset account with that email."
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        "If you already joined on our website, try the email you used there."
      )
    ).toBeTruthy();

    const tryAgain = screen.getByRole("button", { name: "Use a different email" });
    const createNew = screen.getByRole("button", { name: CREATE_ACCOUNT });
    expect(tryAgain.className).toContain("bg-[var(--text)]");
    expect(createNew.className).not.toContain("bg-[var(--text)]");
    expect(createNew.className).toContain("underline");
    expect(
      screen.queryByRole("button", { name: "Send verification code" })
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Create account" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /create an account/i })).toHaveLength(
      1
    );
    expect(signUpCreateMock).not.toHaveBeenCalled();
    expect(
      tryAgain.compareDocumentPosition(createNew) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    await user.click(tryAgain);
    expect(screen.queryByText(/couldn't find a Summitt Mindset account/i)).toBeNull();
    expect(
      (screen.getByRole("textbox", { name: "Email" }) as HTMLInputElement).value
    ).toBe("");
    expect(
      screen.getByRole("button", { name: "Send verification code" }).className
    ).toContain("bg-[var(--text)]");
    expect(document.querySelector("[data-app-auth-mode]")?.getAttribute("data-app-auth-mode")).toBe(
      "sign-in"
    );
  });

  it("does not carry a missing email into create account", async () => {
    signInCreateMock.mockRejectedValue({
      errors: [{ code: "form_identifier_not_found" }],
    });
    const user = userEvent.setup();
    render(<AppEmailCodeSignIn />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.type(
      screen.getByRole("textbox", { name: "Email" }),
      "wrong@example.com"
    );
    await user.click(
      screen.getByRole("button", { name: "Send verification code" })
    );
    await screen.findByRole("button", { name: CREATE_ACCOUNT });

    await user.click(screen.getByRole("button", { name: CREATE_ACCOUNT }));

    expect(signUpCreateMock).not.toHaveBeenCalled();
    expect(
      document.querySelector("[data-app-auth-mode]")?.getAttribute("data-app-auth-mode")
    ).toBe("sign-up");
    expect(
      (screen.getByRole("textbox", { name: "Email" }) as HTMLInputElement).value
    ).toBe("");
  });

  it("shows one code instruction on the sign-in code step", async () => {
    signInCreateMock.mockResolvedValue({
      supportedFirstFactors: [
        { strategy: "email_code", emailAddressId: "idn_email" },
      ],
    });
    prepareFirstFactorMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<AppEmailCodeSignIn />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.type(
      screen.getByRole("textbox", { name: "Email" }),
      "member@example.com"
    );
    await user.click(
      screen.getByRole("button", { name: "Send verification code" })
    );

    expect(
      await screen.findByText("Enter the code we sent to your email.")
    ).toBeTruthy();
    expect(
      screen.getAllByText(/enter the code we sent to your email/i)
    ).toHaveLength(1);
    expect(screen.queryByText(/verification code we sent/i)).toBeNull();
    expect(screen.queryByText(/that email/i)).toBeNull();
  });
});
