import { describe, expect, it } from "vitest";

import {

  buildImportantPeopleFromFields,

  isGenericWeakIdentityAnchor,

  showsGrandkidsNamesField,

  showsKidsNamesField,

  showsLeadServeField,

  showsSpouseNameField,

  WEAK_IDENTITY_PROMPT,

} from "@/lib/onboarding-identity-ui";



describe("onboarding-identity-ui", () => {

  it("shows conditional important people fields by category", () => {

    expect(showsKidsNamesField(["dad"])).toBe(true);

    expect(showsKidsNamesField(["mom"])).toBe(true);

    expect(showsKidsNamesField(["parent"])).toBe(true);

    expect(showsSpouseNameField(["husband"])).toBe(true);

    expect(showsSpouseNameField(["wife"])).toBe(true);

    expect(showsSpouseNameField(["spouse"])).toBe(true);

    expect(showsSpouseNameField(["partner"])).toBe(true);

    expect(showsSpouseNameField(["spouse_partner"])).toBe(true);

    expect(showsGrandkidsNamesField(["grandfather"])).toBe(true);

    expect(showsGrandkidsNamesField(["grandmother"])).toBe(true);

    expect(showsGrandkidsNamesField(["grandparent"])).toBe(true);

    expect(showsLeadServeField(["coach"])).toBe(true);

    expect(showsKidsNamesField(["discipline"])).toBe(false);

  });



  it("builds important_people rows from conditional fields", () => {

    const rows = buildImportantPeopleFromFields(["dad", "husband", "coach"], {

      kidsNames: "Sam, Riley",

      spouseName: "Jordan",

      grandkidsNames: "",

      leadServeText: "My varsity team",

    });

    expect(rows).toEqual([

      { display_name: "Sam", relationship_type: "child" },

      { display_name: "Riley", relationship_type: "child" },

      { display_name: "Jordan", relationship_type: "spouse_partner" },

      { display_name: "My varsity team", relationship_type: "team_player_staff" },

    ]);

  });



  it("treats the best me as weak-but-safe", () => {

    expect(isGenericWeakIdentityAnchor("the best me")).toBe(true);

    expect(WEAK_IDENTITY_PROMPT).toContain("starting point");

  });

});


