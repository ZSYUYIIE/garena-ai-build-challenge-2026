import { randomUUID } from "node:crypto";

import { dashboardAccountSchema, normalizeAccountDraft } from "./accountSchemas.js";
import { AccountRepository } from "./accountRepository.js";

export class MemoryAccountRepository extends AccountRepository {
  constructor({ now = () => new Date(), createId = randomUUID } = {}) {
    super();
    this.accounts = new Map();
    this.now = now;
    this.createId = createId;
  }

  createAccount(input) {
    const draft = normalizeAccountDraft(input);
    if ([...this.accounts.values()].some(
      (account) => account.normalizedEmail === draft.normalizedEmail,
    )) {
      throw duplicateEmailError();
    }
    const timestamp = this.now().toISOString();
    const stored = {
      ...draft,
      version: 1,
      accountId: this.createId(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.accounts.set(stored.accountId, structuredClone(stored));
    return publicAccount(stored);
  }

  getAccount(accountId) {
    const stored = this.accounts.get(accountId);
    return stored ? publicAccount(stored) : null;
  }

  updateAccount(accountId, input) {
    const current = this.accounts.get(accountId);
    if (!current) return null;
    const draft = normalizeAccountDraft(input);
    if ([...this.accounts.values()].some(
      (account) => account.accountId !== accountId
        && account.normalizedEmail === draft.normalizedEmail,
    )) {
      throw duplicateEmailError();
    }
    const stored = {
      ...current,
      ...draft,
      updatedAt: this.now().toISOString(),
    };
    this.accounts.set(accountId, structuredClone(stored));
    return publicAccount(stored);
  }

  close() {
    this.accounts.clear();
  }
}

function publicAccount(stored) {
  const { normalizedEmail: _normalizedEmail, ...account } = stored;
  return dashboardAccountSchema.parse(structuredClone(account));
}

function duplicateEmailError() {
  const error = new Error("An account already uses this email address.");
  error.code = "ACCOUNT_EMAIL_EXISTS";
  return error;
}
