import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";

import {
  AccountApiError,
  accountClient,
  type DashboardAccount,
  type DashboardAccountDraft,
} from "../../api/accountClient";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/StreamSenseUi";
import {
  accountInitials,
  clearDashboardAccount,
  readDashboardAccountId,
  saveDashboardAccountId,
} from "./accountStorage";

const contentPreferenceLabels = {
  mixed: "All entertainment",
  sports: "Sports",
  esports: "Esports and games",
  concerts: "Concerts",
  product_launches: "Product launches",
  creator_livestreams: "Creator livestreams",
} as const;

const narrationPreferenceLabels = {
  minimal: "Minimal",
  standard: "Standard",
  detailed: "Detailed",
  question_only: "Questions only",
} as const;

const emptyDraft: DashboardAccountDraft = {
  displayName: "",
  email: "",
  contentPreference: "mixed",
  narrationPreference: "standard",
};

export function AccountPage() {
  const [account, setAccount] = useState<DashboardAccount | null>(null);
  const [draft, setDraft] = useState<DashboardAccountDraft>(emptyDraft);
  const [loading, setLoading] = useState(() => Boolean(readDashboardAccountId()));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const accountId = readDashboardAccountId();
    if (!accountId) return;
    const controller = new AbortController();
    void accountClient.getAccount(accountId, controller.signal).then((storedAccount) => {
      setAccount(storedAccount);
      setDraft(accountToDraft(storedAccount));
      setError("");
    }).catch((loadError) => {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      if (loadError instanceof AccountApiError && loadError.status === 404) {
        clearDashboardAccount();
      }
      setError(accountErrorMessage(loadError));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  const submitAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");
    setSaving(true);

    try {
      const savedAccount = account
        ? await accountClient.updateAccount(account.accountId, draft)
        : await accountClient.createAccount(draft);
      saveDashboardAccountId(savedAccount.accountId);
      setAccount(savedAccount);
      setDraft(accountToDraft(savedAccount));
      setStatus(account ? "Account preferences updated." : "MongoDB account created.");
    } catch (saveError) {
      setError(
        saveError instanceof z.ZodError
          ? "Enter a display name and a valid email address."
          : accountErrorMessage(saveError),
      );
    } finally {
      setSaving(false);
    }
  };

  const signOut = () => {
    clearDashboardAccount();
    setAccount(null);
    setDraft(emptyDraft);
    setError("");
    setStatus("Signed out on this device.");
  };

  return (
    <div className="page-stack account-page">
      <header className="page-header account-page-header">
        <div>
          <p className="eyebrow">Dashboard identity</p>
          <h1 data-route-heading tabIndex={-1}>
            {account ? "Your StreamSense account" : "Create your StreamSense account"}
          </h1>
          <p className="lede">
            Keep your dashboard identity and viewing preferences in the shared
            StreamSense backend. Live capture and narration remain in the
            Chrome extension.
          </p>
        </div>
        <div className="account-avatar" aria-hidden="true">
          {accountInitials(account)}
        </div>
      </header>

      <aside className="account-privacy-note" aria-label="Prototype account notice">
        <strong>MongoDB prototype profile.</strong>
        <span>
          {" "}The backend stores your name, email, and dashboard preferences.
          This prototype has no password authentication yet and never stores
          API keys or modifies the live narration pipeline.
        </span>
      </aside>

      <form className="account-form" onSubmit={submitAccount}>
        <section className="account-form-section" aria-labelledby="account-identity-heading">
          <div>
            <p className="eyebrow">Identity</p>
            <h2 id="account-identity-heading">Profile details</h2>
            <p className="quiet-copy">
              Stored by the StreamSense backend for dashboard personalization.
            </p>
          </div>
          <div className="account-fields">
            <div className="field">
              <Label htmlFor="account-display-name">Display name</Label>
              <Input
                id="account-display-name"
                name="displayName"
                autoComplete="name"
                minLength={1}
                maxLength={60}
                required
                value={draft.displayName}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
              />
            </div>
            <div className="field">
              <Label htmlFor="account-email">Email</Label>
              <Input
                id="account-email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                value={draft.email}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
              />
              <p className="field-hint">Stored in MongoDB; never used as an API credential.</p>
            </div>
          </div>
        </section>

        <section className="account-form-section" aria-labelledby="account-preferences-heading">
          <div>
            <p className="eyebrow">Defaults</p>
            <h2 id="account-preferences-heading">Entertainment preferences</h2>
            <p className="quiet-copy">
              These preferences prepare the dashboard for future per-account
              personalization without changing current narration behavior.
            </p>
          </div>
          <div className="account-fields">
            <Select
              className="field"
              selectedKey={draft.contentPreference}
              onSelectionChange={(key) => {
                if (key === null) return;
                setDraft((current) => ({
                  ...current,
                  contentPreference: String(key) as DashboardAccountDraft["contentPreference"],
                }));
              }}
            >
              <Label>Primary content</Label>
              <SelectTrigger id="account-content-preference">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(contentPreferenceLabels).map(([value, label]) => (
                  <SelectItem key={value} id={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              className="field"
              selectedKey={draft.narrationPreference}
              onSelectionChange={(key) => {
                if (key === null) return;
                setDraft((current) => ({
                  ...current,
                  narrationPreference: String(key) as DashboardAccountDraft["narrationPreference"],
                }));
              }}
            >
              <Label>Preferred narration detail</Label>
              <SelectTrigger id="account-narration-preference">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(narrationPreferenceLabels).map(([value, label]) => (
                  <SelectItem key={value} id={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>

        {error ? (
          <p className="account-form-message account-form-error" role="alert">
            {error}
          </p>
        ) : null}
        {status ? (
          <p className="account-form-message" role="status">
            {status}
          </p>
        ) : null}

        <div className="account-form-actions">
          <Button size="lg" type="submit" isDisabled={loading || saving}>
            {saving
              ? "Saving account…"
              : account
                ? "Save account changes"
                : "Create MongoDB account"}
          </Button>
          {account ? (
            <Button
              variant="outline"
              size="lg"
              type="button"
              isDisabled={saving}
              onClick={signOut}
            >
              Sign out on this device
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function accountErrorMessage(error: unknown): string {
  if (error instanceof AccountApiError) {
    if (error.code === "ACCOUNT_EMAIL_EXISTS") {
      return "An account already uses this email address.";
    }
    return error.message;
  }
  return "The account could not be saved to MongoDB.";
}

function accountToDraft(account: DashboardAccount): DashboardAccountDraft {
  return {
    displayName: account.displayName,
    email: account.email,
    contentPreference: account.contentPreference,
    narrationPreference: account.narrationPreference,
  };
}
