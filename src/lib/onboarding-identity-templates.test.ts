import { describe, expect, it } from "vitest";

import {

  buildDeterministicIdentityOptions,

  buildIngredientGenerationMaterial,

  countSelectedIngredients,

  getIdentityIngredientGenerationLabel,

  IDENTITY_INGREDIENTS,

  isGenericIdentityOption,

  LEGACY_SPOUSE_PARTNER_ID,

  lineReflectsRoleChip,

  MAX_IDENTITY_INGREDIENTS,

  normalizeIngredientIds,

  partitionIngredientsForGeneration,

  toggleIdentityIngredient,

} from "@/lib/onboarding-identity-templates";



const OLD_BROAD_LABELS = [

  "Father / Mother / Parent",

  "Spouse / Partner",

];



describe("onboarding-identity-templates", () => {

  it("renders human-facing relationship chips instead of old broad labels", () => {

    expect(IDENTITY_INGREDIENTS.some((item) => item.label === "Dad")).toBe(true);

    expect(IDENTITY_INGREDIENTS.some((item) => item.label === "Mom")).toBe(true);

    expect(IDENTITY_INGREDIENTS.some((item) => item.label === "Parent")).toBe(true);

    expect(IDENTITY_INGREDIENTS.some((item) => item.label === "Husband")).toBe(true);

    expect(IDENTITY_INGREDIENTS.some((item) => item.label === "Wife")).toBe(true);

    expect(IDENTITY_INGREDIENTS.some((item) => item.label === "Spouse")).toBe(true);

    expect(IDENTITY_INGREDIENTS.some((item) => item.label === "Partner")).toBe(true);

    expect(IDENTITY_INGREDIENTS.some((item) => item.label === "Grandfather")).toBe(true);

    expect(IDENTITY_INGREDIENTS.some((item) => item.label === "Grandmother")).toBe(true);

    expect(IDENTITY_INGREDIENTS.some((item) => item.label === "Grandparent")).toBe(true);

    for (const label of OLD_BROAD_LABELS) {

      expect(IDENTITY_INGREDIENTS.some((item) => item.label === label)).toBe(false);

    }

    expect(IDENTITY_INGREDIENTS.some((item) => item.label === "More present")).toBe(false);

  });



  it("allows only one parent-group chip at a time", () => {

    let selected = toggleIdentityIngredient([], "dad").next;

    expect(selected).toEqual(["dad"]);

    selected = toggleIdentityIngredient(selected, "mom").next;

    expect(selected).toEqual(["mom"]);

    selected = toggleIdentityIngredient(selected, "mom").next;

    expect(selected).toEqual([]);

  });



  it("allows only one spouse-group chip at a time", () => {

    let selected = toggleIdentityIngredient([], "husband").next;

    selected = toggleIdentityIngredient(selected, "wife").next;

    expect(selected).toEqual(["wife"]);

    selected = toggleIdentityIngredient(selected, "partner").next;

    expect(selected).toEqual(["partner"]);

  });



  it("allows only one grandparent-group chip at a time", () => {

    let selected = toggleIdentityIngredient([], "grandfather").next;

    selected = toggleIdentityIngredient(selected, "grandmother").next;

    expect(selected).toEqual(["grandmother"]);

  });



  it("counts grouped chips as one toward the six-ingredient cap", () => {

    const selected = toggleIdentityIngredient(

      toggleIdentityIngredient(

        toggleIdentityIngredient(

          toggleIdentityIngredient([], "dad").next,

          "husband"

        ).next,

        "provider"

      ).next,

      "presence"

    ).next;

    expect(countSelectedIngredients(selected)).toBe(4);

  });



  it("normalizes legacy ids safely", () => {

    expect(normalizeIngredientIds(["parent", "steadier", "discipline"])).toEqual([

      "parent",

      "discipline",

    ]);

    expect(normalizeIngredientIds([LEGACY_SPOUSE_PARTNER_ID, "discipline"])).toEqual([

      "spouse",

      "discipline",

    ]);

    expect(normalizeIngredientIds(["grandparent", "dad"])).toEqual(["dad", "grandparent"]);

  });



  it("uses human-facing generation labels", () => {

    expect(getIdentityIngredientGenerationLabel("dad")).toBe("dad");

    expect(getIdentityIngredientGenerationLabel("husband")).toBe("husband");

    expect(getIdentityIngredientGenerationLabel("grandmother")).toBe("grandmother");

  });



  it("builds deterministic options with human roles", () => {
    const options = buildDeterministicIdentityOptions({
      preferredName: "Alex",
      ingredientIds: ["dad", "husband", "provider", "presence", "discipline"],
    });
    expect(options.length).toBeGreaterThanOrEqual(3);
    expect(options.some((line) => line.includes("dad"))).toBe(true);
    expect(options.every((line) => !/^I am someone who/i.test(line))).toBe(true);
    expect(options.every((line) => !/\bbest me\b/i.test(line))).toBe(true);
  });

  it("honors dad + husband + entrepreneur + person of faith + presence in deterministic options", () => {
    const options = buildDeterministicIdentityOptions({
      preferredName: "Alex",
      ingredientIds: ["dad", "husband", "entrepreneur", "person_of_faith", "presence"],
      peopleSummaryMirror: "Showing up for 1 child and a spouse/partner",
    });

    expect(options.length).toBeGreaterThanOrEqual(3);

    const fullCoverage = options.find(
      (o) =>
        lineReflectsRoleChip(o, "dad") &&
        lineReflectsRoleChip(o, "husband") &&
        lineReflectsRoleChip(o, "entrepreneur") &&
        lineReflectsRoleChip(o, "person of faith") &&
        /\b(present|presence)\b/i.test(o)
    );
    expect(fullCoverage).toBeTruthy();

    for (const line of options) {
      expect(line).not.toMatch(/\bSam\b|\bJordan\b|\bRiley\b/i);
      expect(isGenericIdentityOption(line)).toBe(false);
    }
  });

  it("requires high fidelity for dad + husband + entrepreneur + leader + discipline + consistency", () => {
    const ingredientIds = [
      "dad",
      "husband",
      "entrepreneur",
      "leader",
      "discipline",
      "consistency",
    ] as const;
    const options = buildDeterministicIdentityOptions({
      preferredName: "Alex",
      ingredientIds: [...ingredientIds],
    });

    expect(options).toHaveLength(5);

    const roleLabels = ["dad", "husband", "entrepreneur", "leader"];
    const withAllRoles = options.filter((line) =>
      roleLabels.every((role) => lineReflectsRoleChip(line, role))
    );
    expect(withAllRoles.length).toBeGreaterThanOrEqual(3);

    const withTraits = options.filter(
      (line) =>
        /\b(disciplined|discipline|follow-through|follow through|consistent|consistency)\b/i.test(
          line
        )
    );
    expect(withTraits.length).toBeGreaterThanOrEqual(3);

    expect(
      options.some(
        (line) =>
          roleLabels.every((role) => lineReflectsRoleChip(line, role)) &&
          /\b(disciplined|discipline)\b/i.test(line) &&
          /\b(consistent|consistency|follow-through|follow through)\b/i.test(line)
      )
    ).toBe(true);

    for (const line of options) {
      expect(isGenericIdentityOption(line)).toBe(false);
      expect(line).not.toMatch(/^\s*I am a disciplined dad\.\s*$/i);
    }
  });

  it("does not drop husband when dad and husband are both selected", () => {
    const options = buildDeterministicIdentityOptions({
      preferredName: "Alex",
      ingredientIds: ["dad", "husband", "discipline"],
    });
    expect(options.every((line) => !/\bdad\b/i.test(line) || /\bhusband\b/i.test(line))).toBe(
      true
    );
  });

  it("includes wife faith courage and service equivalents", () => {
    const options = buildDeterministicIdentityOptions({
      preferredName: "Alex",
      ingredientIds: ["wife", "person_of_faith", "courage", "service"],
    });
    expect(options.some((line) => /\bwife\b/i.test(line))).toBe(true);
    expect(options.some((line) => /\b(faith|faithful)\b/i.test(line))).toBe(true);
    expect(
      options.some((line) => /\b(courage|courageous|hard things)\b/i.test(line))
    ).toBe(true);
    expect(options.some((line) => /\b(serv(e|ing|es)|service)\b/i.test(line))).toBe(true);
  });

  it("builds ingredient generation material with selected role labels", () => {
    const material = buildIngredientGenerationMaterial([
      "dad",
      "husband",
      "entrepreneur",
      "leader",
      "discipline",
      "consistency",
    ]);
    expect(material.selectedRoleLabels).toEqual(["dad", "husband", "entrepreneur", "leader"]);
    expect(material.traitAdjectives).toEqual(["disciplined", "consistent"]);
    expect(material.hasEntrepreneur).toBe(true);
    expect(material.hasLeader).toBe(true);
  });

  it("partitions ingredients into role and trait buckets", () => {
    const partition = partitionIngredientsForGeneration(
      ["dad", "husband", "entrepreneur", "person_of_faith", "presence"],
      { peopleSummaryMirror: "Showing up for 1 child and a spouse/partner" }
    );
    expect(partition.relationshipRoles).toEqual(["dad", "husband"]);
    expect(partition.vocationRoles).toEqual(["business owner"]);
    expect(partition.hasFaith).toBe(true);
    expect(partition.traitAdjectives).toContain("present");
    expect(partition.familyLanguageHints).toContain("my children");
  });



  it("allows up to six ingredients in UI constant", () => {

    expect(MAX_IDENTITY_INGREDIENTS).toBe(6);

  });

});


