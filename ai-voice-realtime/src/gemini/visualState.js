import { z } from "zod";

const snakeCaseStateDomainSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(
    /^[a-z0-9]+(?:_[a-z0-9]+)*$/,
    "domain must use lowercase snake_case",
  );

export const visibleStateSchema = z
  .object({
    domain: snakeCaseStateDomainSchema,
    identity: z.string().trim().min(1).max(160),
    value: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(300),
  })
  .strict();

export const eventEvidenceSchema = z
  .object({
    basis: z.enum(["current_frame", "state_transition"]),
    previousState: visibleStateSchema.nullable(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.basis === "state_transition" && evidence.previousState === null) {
      context.addIssue({
        code: "custom",
        path: ["previousState"],
        message: "previousState is required for state_transition evidence",
      });
    }
    if (evidence.basis === "current_frame" && evidence.previousState !== null) {
      context.addIssue({
        code: "custom",
        path: ["previousState"],
        message: "previousState must be null for current_frame evidence",
      });
    }
  });

export function normalizeVisibleStateKey(state) {
  const normalize = (value) => String(value ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
  return `${normalize(state?.domain)}\u0000${normalize(state?.identity)}`;
}
