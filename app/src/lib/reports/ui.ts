export interface ReportRecipientInput {
  email: string;
}

export function parseRecipientEmails(raw: string): ReportRecipientInput[] {
  const seen = new Set<string>();
  return raw
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0)
    .filter((email) => {
      if (seen.has(email)) return false;
      seen.add(email);
      return true;
    })
    .map((email) => ({ email }));
}
