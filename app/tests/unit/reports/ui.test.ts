import { describe, expect, it } from "vitest";
import { parseRecipientEmails } from "@/lib/reports/ui";

describe("parseRecipientEmails", () => {
  it("normalizes comma and newline separated addresses", () => {
    expect(
      parseRecipientEmails(" ana@example.com,\n team@example.com "),
    ).toEqual([{ email: "ana@example.com" }, { email: "team@example.com" }]);
  });

  it("removes empty entries and duplicate addresses", () => {
    expect(parseRecipientEmails("ana@example.com, , ANA@example.com")).toEqual([
      { email: "ana@example.com" },
    ]);
  });
});
