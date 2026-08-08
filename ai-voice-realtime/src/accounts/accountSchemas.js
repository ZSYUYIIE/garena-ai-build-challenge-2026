import { z } from "zod";

export const contentPreferences = [
  "mixed",
  "sports",
  "esports",
  "concerts",
  "product_launches",
  "creator_livestreams",
];

export const narrationPreferences = [
  "minimal",
  "standard",
  "detailed",
  "question_only",
];

export const accountDraftSchema = z
  .object({
    displayName: z.string().trim().min(1).max(60),
    email: z.string().trim().toLowerCase().email().max(254),
    contentPreference: z.enum(contentPreferences),
    narrationPreference: z.enum(narrationPreferences),
  })
  .strict();

export const dashboardAccountSchema = accountDraftSchema.extend({
  version: z.literal(1),
  accountId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export function normalizeAccountDraft(input) {
  const account = accountDraftSchema.parse(input);
  return {
    ...account,
    normalizedEmail: account.email.toLocaleLowerCase("en-US"),
  };
}
