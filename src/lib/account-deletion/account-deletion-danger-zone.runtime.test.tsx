/**
 * APP-041F4a — runtime Danger Zone UI + useReverification tests (jsdom).
 * No live Clerk/network; fetch and useReverification mocked.
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

const fetchMock = vi.fn();
const useReverificationMock = vi.fn();

vi.mock("@clerk/nextjs", () => ({
  useReverification: (fn: (...args: unknown[]) => unknown) =>
    useReverificationMock(fn),
}));

vi.mock("@clerk/nextjs/errors", () => ({
  isReverificationCancelledError: (err: unknown) =>
    Boolean(
      err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: string }).code === "reverification_cancelled"
    ),
}));

import AccountDeletionDangerZone from "@/components/account-deletion-danger-zone";
import {
  ACCOUNT_DELETION_DANGER_ZONE_TRIGGER,
  ACCOUNT_DELETION_FINAL_ACTION,
  ACCOUNT_DELETION_UI_COPY,
} from "@/lib/account-deletion/account-deletion-danger-zone";

function defaultUseReverification(fn: (...args: unknown[]) => unknown) {
  return (...args: unknown[]) => fn(...args);
}

async function openToConfirmation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: ACCOUNT_DELETION_DANGER_ZONE_TRIGGER })
  );
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

describe("APP-041F4a Danger Zone runtime UI", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    useReverificationMock.mockReset();
    useReverificationMock.mockImplementation(defaultUseReverification);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("22–26. trigger → consequences → confirmation; DELETE gating", async () => {
    const user = userEvent.setup();
    render(<AccountDeletionDangerZone />);

    expect(
      screen.getByRole("button", { name: ACCOUNT_DELETION_DANGER_ZONE_TRIGGER })
    ).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: ACCOUNT_DELETION_DANGER_ZONE_TRIGGER })
    );
    expect(
      screen.getByRole("heading", {
        name: /Delete your account permanently/i,
      })
    ).toBeTruthy();
    expect(document.activeElement?.textContent).toMatch(
      /Delete your account permanently/i
    );

    await user.click(screen.getByRole("button", { name: "Continue" }));
    const input = screen.getByLabelText(/Type DELETE to confirm/i);
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);

    const submit = screen.getByRole("button", {
      name: ACCOUNT_DELETION_FINAL_ACTION,
    });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await user.type(input, "delete");
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.clear(input);
    await user.type(input, " DELETE");
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.clear(input);
    await user.type(input, "DELETE");
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("27–28. Cancel resets; reopen empty", async () => {
    const user = userEvent.setup();
    render(<AccountDeletionDangerZone />);
    await openToConfirmation(user);
    const input = screen.getByLabelText(/Type DELETE to confirm/i);
    await user.type(input, "DELETE");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.getByRole("button", { name: ACCOUNT_DELETION_DANGER_ZONE_TRIGGER })
    ).toBeTruthy();
    expect(document.activeElement?.textContent).toBe(
      ACCOUNT_DELETION_DANGER_ZONE_TRIGGER
    );

    await openToConfirmation(user);
    expect(
      (screen.getByLabelText(/Type DELETE to confirm/i) as HTMLInputElement)
        .value
    ).toBe("");
  });

  it("29–30. double-click one request; Cancel/Escape blocked while submitting", async () => {
    const user = userEvent.setup();
    let resolveFetch: (v: unknown) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    render(<AccountDeletionDangerZone />);
    await openToConfirmation(user);
    await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "DELETE");
    const submit = screen.getByRole("button", {
      name: ACCOUNT_DELETION_FINAL_ACTION,
    });
    await user.click(submit);
    await user.click(submit);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.getByText("Submitting…")).toBeTruthy();

    resolveFetch({
      ok: true,
      json: async () => ({ ok: true, code: "accepted_new" }),
    });
    await waitFor(() => {
      expect(screen.getByText(ACCOUNT_DELETION_UI_COPY.accepted)).toBeTruthy();
    });
  });

  it("31–33. accepted / existing / invalid_confirmation mapping", async () => {
    const user = userEvent.setup();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, code: "accepted_new" }),
    });
    const { unmount } = render(<AccountDeletionDangerZone />);
    await openToConfirmation(user);
    await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "DELETE");
    await user.click(
      screen.getByRole("button", { name: ACCOUNT_DELETION_FINAL_ACTION })
    );
    await waitFor(() => {
      expect(screen.getByText(ACCOUNT_DELETION_UI_COPY.accepted)).toBeTruthy();
    });
    expect(screen.queryByText("accepted_new")).toBeNull();
    unmount();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, code: "accepted_existing" }),
    });
    render(<AccountDeletionDangerZone />);
    await openToConfirmation(user);
    await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "DELETE");
    await user.click(
      screen.getByRole("button", { name: ACCOUNT_DELETION_FINAL_ACTION })
    );
    await waitFor(() => {
      expect(screen.getByText(ACCOUNT_DELETION_UI_COPY.existing)).toBeTruthy();
    });
    cleanup();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ ok: false, code: "invalid_confirmation" }),
    });
    render(<AccountDeletionDangerZone />);
    await openToConfirmation(user);
    await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "DELETE");
    await user.click(
      screen.getByRole("button", { name: ACCOUNT_DELETION_FINAL_ACTION })
    );
    await waitFor(() => {
      expect(
        screen.getByText(ACCOUNT_DELETION_UI_COPY.invalid_confirmation)
      ).toBeTruthy();
    });
    expect(
      (screen.getByLabelText(/Type DELETE to confirm/i) as HTMLInputElement)
        .value
    ).toBe("");
  });

  it("34–36. network/non-JSON/unauthorized safe handling", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });

    fetchMock.mockRejectedValueOnce(new Error("network down"));
    render(<AccountDeletionDangerZone />);
    await openToConfirmation(user);
    await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "DELETE");
    await user.click(
      screen.getByRole("button", { name: ACCOUNT_DELETION_FINAL_ACTION })
    );
    await waitFor(() => {
      expect(screen.getByText(ACCOUNT_DELETION_UI_COPY.generic)).toBeTruthy();
    });
    expect(screen.queryByText("network down")).toBeNull();
    cleanup();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => {
        throw new Error("bad json");
      },
    });
    render(<AccountDeletionDangerZone />);
    await openToConfirmation(user);
    await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "DELETE");
    await user.click(
      screen.getByRole("button", { name: ACCOUNT_DELETION_FINAL_ACTION })
    );
    await waitFor(() => {
      expect(screen.getByText(ACCOUNT_DELETION_UI_COPY.generic)).toBeTruthy();
    });
    cleanup();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ ok: false, code: "unauthorized" }),
    });
    render(<AccountDeletionDangerZone />);
    await openToConfirmation(user);
    await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "DELETE");
    await user.click(
      screen.getByRole("button", { name: ACCOUNT_DELETION_FINAL_ACTION })
    );
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("/sign-in");
    });
    expect(screen.queryByText("unauthorized")).toBeNull();
    expect(screen.queryByText("Submitting…")).toBeNull();
  });

  it("44–49. Escape restores trigger focus; result announced", async () => {
    const user = userEvent.setup();
    render(<AccountDeletionDangerZone />);
    await user.click(
      screen.getByRole("button", { name: ACCOUNT_DELETION_DANGER_ZONE_TRIGGER })
    );
    await user.keyboard("{Escape}");
    expect(document.activeElement?.textContent).toBe(
      ACCOUNT_DELETION_DANGER_ZONE_TRIGGER
    );

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, code: "accepted_new" }),
    });
    await openToConfirmation(user);
    await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "DELETE");
    await user.click(
      screen.getByRole("button", { name: ACCOUNT_DELETION_FINAL_ACTION })
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toBeTruthy();
      expect(screen.getByText(ACCOUNT_DELETION_UI_COPY.accepted)).toBeTruthy();
    });
    expect(document.activeElement).toBe(screen.getByRole("status"));
  });
});

describe("APP-041F4a useReverification runtime", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    useReverificationMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("38. normal success → one POST", async () => {
    useReverificationMock.mockImplementation(defaultUseReverification);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, code: "accepted_new" }),
    });
    const user = userEvent.setup();
    render(<AccountDeletionDangerZone />);
    await openToConfirmation(user);
    await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "DELETE");
    await user.click(
      screen.getByRole("button", { name: ACCOUNT_DELETION_FINAL_ACTION })
    );
    await waitFor(() => {
      expect(screen.getByText(ACCOUNT_DELETION_UI_COPY.accepted)).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("39–40. hint triggers challenge; success retries once", async () => {
    useReverificationMock.mockImplementation(
      (fn: () => Promise<unknown>) => async () => {
        const first = await fn();
        if (
          first &&
          typeof first === "object" &&
          "clerk_error" in (first as object)
        ) {
          return fn();
        }
        return first;
      }
    );
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          clerk_error: {
            type: "forbidden",
            reason: "reverification-error",
            metadata: { reverification: "strict" },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, code: "accepted_new" }),
      });

    const user = userEvent.setup();
    render(<AccountDeletionDangerZone />);
    await openToConfirmation(user);
    await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "DELETE");
    await user.click(
      screen.getByRole("button", { name: ACCOUNT_DELETION_FINAL_ACTION })
    );
    await waitFor(() => {
      expect(screen.getByText(ACCOUNT_DELETION_UI_COPY.accepted)).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("41. cancelled challenge → no additional POST; safe reauth copy", async () => {
    useReverificationMock.mockImplementation(() => async () => {
      throw { code: "reverification_cancelled" };
    });
    const user = userEvent.setup();
    render(<AccountDeletionDangerZone />);
    await openToConfirmation(user);
    await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "DELETE");
    await user.click(
      screen.getByRole("button", { name: ACCOUNT_DELETION_FINAL_ACTION })
    );
    await waitFor(() => {
      expect(screen.getByText(ACCOUNT_DELETION_UI_COPY.reauth)).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("42–43. failed challenge → reauth error; no custom OTP/infinite retry", async () => {
    let calls = 0;
    useReverificationMock.mockImplementation(
      (fn: () => Promise<unknown>) => async () => {
        calls += 1;
        expect(calls).toBeLessThanOrEqual(2);
        const result = await fn();
        if (
          result &&
          typeof result === "object" &&
          "clerk_error" in (result as object)
        ) {
          // Simulate challenge then still-hint once (Clerk does not loop).
          return result;
        }
        return result;
      }
    );
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({
        clerk_error: {
          type: "forbidden",
          reason: "reverification-error",
          metadata: { reverification: "strict" },
        },
      }),
    });

    const user = userEvent.setup();
    render(<AccountDeletionDangerZone />);
    await openToConfirmation(user);
    await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "DELETE");
    await user.click(
      screen.getByRole("button", { name: ACCOUNT_DELETION_FINAL_ACTION })
    );
    await waitFor(() => {
      expect(screen.getByText(ACCOUNT_DELETION_UI_COPY.reauth)).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/otp|password/i)).toBeNull();
  });
});
