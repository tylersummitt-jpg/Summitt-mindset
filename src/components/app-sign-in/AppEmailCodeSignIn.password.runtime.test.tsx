/**
 * Runtime tests for optional password sign-in on /app/sign-in.
 * Mocks match @clerk/nextjs useSignIn / useSignUp shapes used by AppEmailCodeSignIn.
 * No live Clerk; no real credentials.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const replaceMock = vi.fn();
const setActiveMock = vi.fn();
const signInCreateMock = vi.fn();
const prepareFirstFactorMock = vi.fn();
const attemptFirstFactorMock = vi.fn();
const signUpCreateMock = vi.fn();
const prepareEmailAddressVerificationMock = vi.fn();
const attemptEmailAddressVerificationMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
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
    setActive: setActiveMock,
    signIn: {
      create: signInCreateMock,
      prepareFirstFactor: prepareFirstFactorMock,
      attemptFirstFactor: attemptFirstFactorMock,
    },
  }),
  useSignUp: () => ({
    isLoaded: true,
    setActive: setActiveMock,
    signUp: {
      create: signUpCreateMock,
      prepareEmailAddressVerification: prepareEmailAddressVerificationMock,
      attemptEmailAddressVerification: attemptEmailAddressVerificationMock,
    },
  }),
}));

vi.mock("@clerk/nextjs/errors", () => ({
  isClerkAPIResponseError: (err: unknown) =>
    Boolean(err && typeof err === "object" && "errors" in err),
}));

import AppEmailCodeSignIn from "@/components/app-sign-in/AppEmailCodeSignIn";
import { APP_POST_AUTH_PATH } from "@/lib/app-sign-in/app-sign-in-constants";

async function openSignIn(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("AppEmailCodeSignIn optional password factor", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    setActiveMock.mockReset();
    signInCreateMock.mockReset();
    prepareFirstFactorMock.mockReset();
    attemptFirstFactorMock.mockReset();
    signUpCreateMock.mockReset();
    prepareEmailAddressVerificationMock.mockReset();
    attemptEmailAddressVerificationMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps email-code as the default Sign in path", async () => {
    const user = userEvent.setup();
    render(<AppEmailCodeSignIn />);
    await openSignIn(user);

    expect(
      screen.getByRole("button", { name: "Send verification code" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Sign in with password" })
    ).toBeTruthy();
    expect(screen.queryByLabelText(/^Password$/i)).toBeNull();
  });

  it("does not offer password mode on Create account", async () => {
    const user = userEvent.setup();
    render(<AppEmailCodeSignIn />);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      screen.getByRole("button", { name: "Send verification code" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in with password" })).toBeNull();
    expect(screen.queryByLabelText(/^Password$/i)).toBeNull();
    expect(document.querySelector("#clerk-captcha")).toBeTruthy();
  });

  it("prepares and verifies email-code sign-in through /post-sign-in", async () => {
    const user = userEvent.setup();
    signInCreateMock.mockResolvedValue({
      supportedFirstFactors: [
        { strategy: "email_code", emailAddressId: "idn_email" },
      ],
    });
    prepareFirstFactorMock.mockResolvedValue({});
    attemptFirstFactorMock.mockResolvedValue({
      status: "complete",
      createdSessionId: "sess_email",
    });

    render(<AppEmailCodeSignIn />);
    await openSignIn(user);
    await user.type(screen.getByLabelText(/^Email$/i), "member@example.com");
    await user.click(
      screen.getByRole("button", { name: "Send verification code" })
    );

    await waitFor(() => {
      expect(signInCreateMock).toHaveBeenCalledWith({
        identifier: "member@example.com",
      });
      expect(prepareFirstFactorMock).toHaveBeenCalledWith({
        strategy: "email_code",
        emailAddressId: "idn_email",
      });
    });

    await user.type(screen.getByLabelText(/Verification code/i), "123456");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(attemptFirstFactorMock).toHaveBeenCalledWith({
        strategy: "email_code",
        code: "123456",
      });
      expect(setActiveMock).toHaveBeenCalledWith({ session: "sess_email" });
      expect(replaceMock).toHaveBeenCalledWith(APP_POST_AUTH_PATH);
    });
  });

  it("activates session on successful password first factor", async () => {
    const user = userEvent.setup();
    signInCreateMock.mockResolvedValue({
      supportedFirstFactors: [
        { strategy: "email_code", emailAddressId: "idn_email" },
        { strategy: "password" },
      ],
    });
    attemptFirstFactorMock.mockResolvedValue({
      status: "complete",
      createdSessionId: "sess_pw",
    });

    render(<AppEmailCodeSignIn />);
    await openSignIn(user);
    await user.click(
      screen.getByRole("button", { name: "Sign in with password" })
    );
    await user.type(screen.getByLabelText(/^Email$/i), "member@example.com");
    await user.type(screen.getByLabelText(/^Password$/i), "correct-horse");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(attemptFirstFactorMock).toHaveBeenCalledWith({
        strategy: "password",
        password: "correct-horse",
      });
      expect(setActiveMock).toHaveBeenCalledWith({ session: "sess_pw" });
      expect(replaceMock).toHaveBeenCalledWith(APP_POST_AUTH_PATH);
    });

    // Password field cleared after submit (not retained in the input).
    expect((screen.getByLabelText(/^Password$/i) as HTMLInputElement).value).toBe(
      ""
    );
  });

  it("does not claim wrong password when password factor is unavailable", async () => {
    const user = userEvent.setup();
    signInCreateMock.mockResolvedValue({
      supportedFirstFactors: [
        { strategy: "email_code", emailAddressId: "idn_email" },
      ],
    });

    render(<AppEmailCodeSignIn />);
    await openSignIn(user);
    await user.click(
      screen.getByRole("button", { name: "Sign in with password" })
    );
    await user.type(screen.getByLabelText(/^Email$/i), "member@example.com");
    await user.type(screen.getByLabelText(/^Password$/i), "any-value");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(
        screen.getByText(/Password sign-in is not available for this account/i)
      ).toBeTruthy();
    });
    expect(attemptFirstFactorMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Use an email code instead" })
    ).toBeTruthy();
  });

  it("maps wrong-password Clerk errors to a safe message and keeps email-code fallback", async () => {
    const user = userEvent.setup();
    signInCreateMock.mockResolvedValue({
      supportedFirstFactors: [{ strategy: "password" }],
    });
    attemptFirstFactorMock.mockRejectedValue({
      errors: [{ code: "form_password_incorrect" }],
    });

    render(<AppEmailCodeSignIn />);
    await openSignIn(user);
    await user.click(
      screen.getByRole("button", { name: "Sign in with password" })
    );
    await user.type(screen.getByLabelText(/^Email$/i), "member@example.com");
    await user.type(screen.getByLabelText(/^Password$/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(
        screen.getByText(/That email or password is incorrect/i)
      ).toBeTruthy();
    });
    expect(
      screen.getByRole("button", { name: "Use an email code instead" })
    ).toBeTruthy();
    expect(setActiveMock).not.toHaveBeenCalled();
  });

  it("does not bypass needs_second_factor after password attempt", async () => {
    const user = userEvent.setup();
    signInCreateMock.mockResolvedValue({
      supportedFirstFactors: [{ strategy: "password" }],
    });
    attemptFirstFactorMock.mockResolvedValue({
      status: "needs_second_factor",
      createdSessionId: null,
    });

    render(<AppEmailCodeSignIn />);
    await openSignIn(user);
    await user.click(
      screen.getByRole("button", { name: "Sign in with password" })
    );
    await user.type(screen.getByLabelText(/^Email$/i), "member@example.com");
    await user.type(screen.getByLabelText(/^Password$/i), "has-mfa");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(
        screen.getByText(/Additional verification is required/i)
      ).toBeTruthy();
    });
    expect(setActiveMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("handles needs_new_password without inventing a reset flow", async () => {
    const user = userEvent.setup();
    signInCreateMock.mockResolvedValue({
      supportedFirstFactors: [{ strategy: "password" }],
    });
    attemptFirstFactorMock.mockResolvedValue({
      status: "needs_new_password",
      createdSessionId: null,
    });

    render(<AppEmailCodeSignIn />);
    await openSignIn(user);
    await user.click(
      screen.getByRole("button", { name: "Sign in with password" })
    );
    await user.type(screen.getByLabelText(/^Email$/i), "member@example.com");
    await user.type(screen.getByLabelText(/^Password$/i), "needs-reset");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(
        screen.getByText(/needs a password update/i)
      ).toBeTruthy();
    });
    expect(setActiveMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Use an email code instead" })
    ).toBeTruthy();
  });

  it("keeps create-account on email-code verification only", async () => {
    const user = userEvent.setup();
    signUpCreateMock.mockResolvedValue({});
    prepareEmailAddressVerificationMock.mockResolvedValue({});
    attemptEmailAddressVerificationMock.mockResolvedValue({
      status: "complete",
      createdSessionId: "sess_signup",
    });

    render(<AppEmailCodeSignIn />);
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await user.type(screen.getByLabelText(/^Email$/i), "new@example.com");
    await user.click(
      screen.getByRole("button", { name: "Send verification code" })
    );

    await waitFor(() => {
      expect(signUpCreateMock).toHaveBeenCalledWith({
        emailAddress: "new@example.com",
      });
      expect(prepareEmailAddressVerificationMock).toHaveBeenCalledWith({
        strategy: "email_code",
      });
    });

    await user.type(screen.getByLabelText(/Verification code/i), "654321");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(attemptEmailAddressVerificationMock).toHaveBeenCalledWith({
        code: "654321",
      });
      expect(setActiveMock).toHaveBeenCalledWith({ session: "sess_signup" });
      expect(replaceMock).toHaveBeenCalledWith(APP_POST_AUTH_PATH);
    });
  });

  it("does not render social or reviewer-specific auth", () => {
    render(<AppEmailCodeSignIn />);
    expect(screen.queryByText(/Google/i)).toBeNull();
    expect(screen.queryByText(/Apple/i)).toBeNull();
    expect(screen.queryByText(/reviewer/i)).toBeNull();
    expect(screen.queryByText(/oauth/i)).toBeNull();
  });
});
