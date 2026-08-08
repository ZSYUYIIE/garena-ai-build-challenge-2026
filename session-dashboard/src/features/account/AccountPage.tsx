import { useState, type FormEvent } from "react";
import { z } from "zod";

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
  readDashboardAccount,
  saveDashboardAccount,
  type DashboardAccount,
  type DashboardAccountDraft,
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
  const [account, setAccount] = useState<DashboardAccount | null>(() =>
    readDashboardAccount(),
  );
  const [draft, setDraft] = useState<DashboardAccountDraft>(() =>
    account ? accountToDraft(account) : emptyDraft,
  );
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const submitAccount = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    try {
      const savedAccount = saveDashboardAccount(draft, account);
      setAccount(savedAccount);
      setDraft(accountToDraft(savedAccount));
      setStatus(account ? "Account preferences updated." : "Local account created.");
    } catch (saveError) {
      setStatus("");
      setError(
        saveError instanceof z.ZodError
          ? "Enter a display name and a valid email address."
          : "The account could not be saved in this browser.",
      );
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
            Keep your dashboard identity and viewing preferences consistent on
            this device. Live capture and narration remain in the Chrome
            extension.
          </p>
        </div>
        <div className="account-avatar" aria-hidden="true">
          {accountInitials(account)}
        </div>
      </header>

      <aside className="account-privacy-note" aria-label="Prototype account notice">
        <strong>Local prototype account.</strong>
        <span>
          {" "}This profile is stored only in this browser. It does not upload
          credentials, filter the shared session database, or modify the live
          narration pipeline.
        </span>
      </aside>

      <form className="account-form" onSubmit={submitAccount}>
        <section className="account-form-section" aria-labelledby="account-identity-heading">
          <div>
            <p className="eyebrow">Identity</p>
            <h2 id="account-identity-heading">Profile details</h2>
            <p className="quiet-copy">
              Used to personalize the Memory dashboard on this device.
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
              <p className="field-hint">Stored locally; never sent to StreamSense.</p>
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
          <Button size="lg" type="submit">
            {account ? "Save account changes" : "Create local account"}
          </Button>
          {account ? (
            <Button variant="outline" size="lg" type="button" onClick={signOut}>
              Sign out on this device
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function accountToDraft(account: DashboardAccount): DashboardAccountDraft {
  return {
    displayName: account.displayName,
    email: account.email,
    contentPreference: account.contentPreference,
    narrationPreference: account.narrationPreference,
  };
}
