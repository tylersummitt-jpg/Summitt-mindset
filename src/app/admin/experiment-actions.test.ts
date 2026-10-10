import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireTylerAdminMock = vi.hoisted(() => vi.fn());
const insertMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());
const changeMock = vi.hoisted(() => vi.fn());
const amendMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/require-tyler-admin", () => ({
  requireTylerAdmin: (...args: unknown[]) => requireTylerAdminMock(...args),
}));
vi.mock("@/lib/operating-experiments.server", () => ({
  insertPlannedExperiment: (...args: unknown[]) => insertMock(...args),
  updatePlannedExperiment: (...args: unknown[]) => updateMock(...args),
  applyStoredExperimentChange: (...args: unknown[]) => changeMock(...args),
  addExperimentAmendment: (...args: unknown[]) => amendMock(...args),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  amendOperatingExperiment,
  createOperatingExperiment,
  finishOperatingExperiment,
  startOperatingExperiment,
} from "@/app/admin/experiment-actions";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("experiment admin actions", () => {
  beforeEach(() => {
    requireTylerAdminMock.mockReset();
    insertMock.mockReset();
    updateMock.mockReset();
    changeMock.mockReset();
    amendMock.mockReset();
  });

  it("rejects an unauthorized create before saving", async () => {
    requireTylerAdminMock.mockRejectedValue(
      Object.assign(new Error("FORBIDDEN"), { status: 403 })
    );
    await expect(
      createOperatingExperiment(
        form({
          name: "Homepage paid conversion",
          area: "distribution",
          hypothesis: "A shorter page increases paid conversion.",
          control: "Current homepage",
          challenger: "Shorter homepage",
          primaryOutcome: "Eventual paid conversion",
          decisionCriteria: "Wait for paid outcomes.",
        })
      )
    ).rejects.toMatchObject({ status: 403 });
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(changeMock).not.toHaveBeenCalled();
    expect(amendMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthorized start, finish, and amendment before saving", async () => {
    requireTylerAdminMock.mockRejectedValue(
      Object.assign(new Error("UNAUTHORIZED"), { status: 401 })
    );
    await expect(startOperatingExperiment(form({ id: "exp-1" }))).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      finishOperatingExperiment(
        form({
          id: "exp-1",
          evidence: "proven",
          conclusion: "This should not be saved.",
          nextAction: "Ship it.",
        })
      )
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      amendOperatingExperiment(form({ id: "exp-1", note: "Quiet rewrite." }))
    ).rejects.toMatchObject({ status: 401 });
    expect(changeMock).not.toHaveBeenCalled();
    expect(amendMock).not.toHaveBeenCalled();
  });
});
