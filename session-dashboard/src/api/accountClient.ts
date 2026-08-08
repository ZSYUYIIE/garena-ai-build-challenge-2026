import { z } from "zod";

export const contentPreferences = [
  "mixed",
  "sports",
  "esports",
  "concerts",
  "product_launches",
  "creator_livestreams",
] as const;

export const narrationPreferences = [
  "minimal",
  "standard",
  "detailed",
  "question_only",
] as const;

const dashboardAccountDraftSchema = z.object({
  displayName: z.string().trim().min(1).max(60),
  email: z.string().trim().toLowerCase().email().max(254),
  contentPreference: z.enum(contentPreferences),
  narrationPreference: z.enum(narrationPreferences),
});

const dashboardAccountSchema = dashboardAccountDraftSchema.extend({
  version: z.literal(1),
  accountId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const accountResponseSchema = z.object({ account: dashboardAccountSchema });
const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type DashboardAccount = z.infer<typeof dashboardAccountSchema>;
export type DashboardAccountDraft = z.infer<typeof dashboardAccountDraftSchema>;

export class AccountApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, { code, status }: { code: string; status: number }) {
    super(message);
    this.name = "AccountApiError";
    this.code = code;
    this.status = status;
  }
}

export const accountClient = {
  async createAccount(draft: DashboardAccountDraft): Promise<DashboardAccount> {
    return request("/api/accounts", {
      method: "POST",
      body: JSON.stringify(dashboardAccountDraftSchema.parse(draft)),
    });
  },

  getAccount(accountId: string, signal?: AbortSignal): Promise<DashboardAccount> {
    return request(`/api/accounts/${encodeURIComponent(accountId)}`, { signal });
  },

  async updateAccount(
    accountId: string,
    draft: DashboardAccountDraft,
  ): Promise<DashboardAccount> {
    return request(`/api/accounts/${encodeURIComponent(accountId)}`, {
      method: "PUT",
      body: JSON.stringify(dashboardAccountDraftSchema.parse(draft)),
    });
  },
};

async function request(url: string, init: RequestInit): Promise<DashboardAccount> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AccountApiError(
      "StreamSense account storage could not be reached. Check that the backend and MongoDB are running.",
      { code: "network_error", status: 0 },
    );
  }

  const body = await readJson(response);
  if (!response.ok) {
    const parsedError = errorResponseSchema.safeParse(body);
    throw new AccountApiError(
      parsedError.success
        ? parsedError.data.error.message
        : `The account request failed with status ${response.status}.`,
      {
        code: parsedError.success ? parsedError.data.error.code : "unexpected_http_error",
        status: response.status,
      },
    );
  }

  const parsed = accountResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new AccountApiError(
      "StreamSense account storage returned data in an unexpected format.",
      { code: "invalid_response", status: response.status },
    );
  }
  return parsed.data.account;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
