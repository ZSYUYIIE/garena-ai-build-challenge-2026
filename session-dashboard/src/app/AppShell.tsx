import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { Button, buttonVariants } from "../components/StreamSenseUi";

const HIGH_CONTRAST_STORAGE_KEY = "streamsense.dashboard.highContrast";
const FOCUS_WAIT_MILLISECONDS = 5_000;

type PendingFocus = {
  id: number;
  selector: string;
  successMessage: string;
  failureMessage: string;
};

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialLocation = useRef(location.pathname);
  const focusRequestId = useRef(0);
  const shortcutHelpButtonRef = useRef<HTMLButtonElement>(null);
  const [highContrast, setHighContrast] = useState(readStoredHighContrast);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [shortcutStatus, setShortcutStatus] = useState("");
  const [pendingFocus, setPendingFocus] = useState<PendingFocus | null>(null);
  const searchParameters = new URLSearchParams(location.search);
  const fromExtension = searchParameters.get("source") === "extension";
  const extensionSessionHandoff =
    fromExtension && /^\/sessions\/[^/]+$/.test(location.pathname);

  useEffect(() => {
    if (initialLocation.current === location.pathname) {
      initialLocation.current = "";
      return;
    }
    const heading = document.querySelector<HTMLElement>("[data-route-heading]");
    heading?.focus();
  }, [location.pathname]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        HIGH_CONTRAST_STORAGE_KEY,
        highContrast ? "true" : "false",
      );
    } catch {
      // The control remains effective for this tab when storage is unavailable.
    }
  }, [highContrast]);

  useEffect(() => {
    const root = document.documentElement;
    if (highContrast) {
      root.dataset.streamsenseDashboardContrast = "high";
    } else {
      delete root.dataset.streamsenseDashboardContrast;
    }
    return () => {
      delete root.dataset.streamsenseDashboardContrast;
    };
  }, [highContrast]);

  useEffect(() => {
    if (!pendingFocus) return;

    const request = pendingFocus;
    let settled = false;
    let observer: MutationObserver | null = null;

    const finish = (message: string) => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      window.clearTimeout(timeout);
      setShortcutStatus(message);
      setPendingFocus((current) =>
        current?.id === request.id ? null : current,
      );
    };

    const focusTarget = () => {
      const target = document.querySelector<HTMLElement>(request.selector);
      if (!target || target.matches(":disabled")) return false;
      target.focus();
      if (document.activeElement !== target) return false;
      finish(request.successMessage);
      return true;
    };

    const timeout = window.setTimeout(() => {
      finish(request.failureMessage);
    }, FOCUS_WAIT_MILLISECONDS);

    if (!focusTarget()) {
      observer = new MutationObserver(() => {
        focusTarget();
      });
      observer.observe(document.getElementById("main-content") ?? document.body, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    }

    return () => {
      settled = true;
      observer?.disconnect();
      window.clearTimeout(timeout);
    };
  }, [location.pathname, pendingFocus]);

  const requestFocus = (
    selector: string,
    successMessage: string,
    failureMessage: string,
  ) => {
    focusRequestId.current += 1;
    setPendingFocus({
      id: focusRequestId.current,
      selector,
      successMessage,
      failureMessage,
    });
  };

  const openMemory = () => {
    navigate("/");
    requestFocus(
      "[data-route-heading]",
      "StreamSense Memory opened.",
      "StreamSense Memory opened, but its heading was not available to focus.",
    );
  };

  const openSearch = () => {
    navigate("/search");
    requestFocus(
      "#history-query",
      "Memory search focused.",
      "Memory search opened, but its search field was not available to focus.",
    );
  };

  const focusGraph = () => {
    const graphSelector = document.querySelector<HTMLElement>(
      "[data-graph-node-selector]",
    );
    if (graphSelector && !graphSelector.matches(":disabled")) {
      graphSelector.focus();
      setShortcutStatus("Relationship map selector focused.");
      return;
    }

    navigate("/");
    requestFocus(
      "[data-graph-node-selector]",
      "Relationship map selector focused.",
      "The relationship map selector is not available right now.",
    );
  };

  const toggleHighContrast = () => {
    const nextHighContrast = !highContrast;
    setHighContrast(nextHighContrast);
    setShortcutStatus(
      `High contrast ${nextHighContrast ? "enabled" : "disabled"}.`,
    );
  };

  const closeShortcutHelp = (restoreFocus = false) => {
    setShortcutHelpOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => shortcutHelpButtonRef.current?.focus());
    }
  };

  const toggleShortcutHelp = (focusHelpHeading = false) => {
    if (shortcutHelpOpen) {
      closeShortcutHelp(focusHelpHeading);
      return;
    }
    setShortcutHelpOpen(true);
    setShortcutStatus("Keyboard shortcut help opened.");
    if (focusHelpHeading) {
      requestFocus(
        "#dashboard-shortcuts-heading",
        "Keyboard shortcut help focused.",
        "Keyboard shortcut help opened.",
      );
    }
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;

      const key = event.key.toLocaleLowerCase("en-US");
      if (
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        key === "k"
      ) {
        event.preventDefault();
        openSearch();
        return;
      }

      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        if (key === "h") {
          event.preventDefault();
          openMemory();
        } else if (key === "g") {
          event.preventDefault();
          focusGraph();
        } else if (key === "c") {
          event.preventDefault();
          toggleHighContrast();
        } else if (key === "/") {
          event.preventDefault();
          toggleShortcutHelp(true);
        }
        return;
      }

      if (event.key === "Escape" && shortcutHelpOpen) {
        event.preventDefault();
        closeShortcutHelp(true);
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  return (
    <div
      className="app-shell"
      data-contrast={highContrast ? "high" : undefined}
    >
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <NavLink className="brand" to="/" aria-label="StreamSense Memory home">
            <span className="brand-mark" aria-hidden="true">
              S
            </span>
            <span>
              <strong>StreamSense</strong>
              <small>Live + Memory</small>
            </span>
          </NavLink>
          <nav aria-label="StreamSense navigation">
            <ul className="primary-navigation">
              <li>
                <NavLink
                  to="/"
                  end
                  aria-keyshortcuts="Alt+H"
                  className={({ isActive }) =>
                    buttonVariants({
                      variant: isActive ? "secondary" : "ghost",
                      size: "lg",
                    })
                  }
                >
                  Memory
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/search"
                  aria-keyshortcuts="Control+K"
                  className={({ isActive }) =>
                    buttonVariants({
                      variant: isActive ? "secondary" : "ghost",
                      size: "lg",
                    })
                  }
                >
                  Search
                </NavLink>
              </li>
            </ul>
          </nav>
          <div
            className="shell-actions shell-accessibility-controls"
            role="group"
            aria-label="Dashboard tools"
          >
            <button
              className={buttonVariants({
                variant: "outline",
                size: "lg",
                className: "shell-control",
              })}
              type="button"
              onClick={focusGraph}
              aria-keyshortcuts="Alt+G"
            >
              Focus map
            </button>
            <button
              className={buttonVariants({
                variant: "outline",
                size: "lg",
                className: "shell-control shell-contrast-toggle",
              })}
              type="button"
              onClick={toggleHighContrast}
              aria-keyshortcuts="Alt+C"
              aria-pressed={highContrast}
            >
              High contrast
              <span className="shell-control-state">
                {highContrast ? "On" : "Off"}
              </span>
            </button>
            <button
              ref={shortcutHelpButtonRef}
              className={buttonVariants({
                variant: "outline",
                size: "lg",
                className: "shell-control",
              })}
              type="button"
              onClick={() => toggleShortcutHelp(false)}
              aria-keyshortcuts="Alt+/"
              aria-expanded={shortcutHelpOpen}
              aria-controls="dashboard-shortcut-help"
            >
              Keyboard shortcuts
            </button>
          </div>
        </div>
      </header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        {fromExtension ? (
          <aside
            className="surface-connection extension-handoff"
            aria-label="StreamSense extension handoff"
          >
            <strong>Opened from StreamSense Live.</strong>
            <span>
              {extensionSessionHandoff
                ? " This saved session memory refreshes periodically from the shared backend while the page is open. Live capture and controls remain in the extension side panel."
                : " Live capture and controls remain in the extension side panel; this Memory view reads saved sessions from the shared backend."}
            </span>
          </aside>
        ) : null}

        {shortcutHelpOpen ? (
          <section
            id="dashboard-shortcut-help"
            className="shortcut-panel shortcut-help-panel"
            aria-labelledby="dashboard-shortcuts-heading"
          >
            <div className="shortcut-help-heading">
              <div>
                <p className="eyebrow">Dashboard help</p>
                <h2 id="dashboard-shortcuts-heading" tabIndex={-1}>
                  Keyboard shortcuts
                </h2>
              </div>
              <Button
                variant="outline"
                size="lg"
                type="button"
                onClick={() => closeShortcutHelp(true)}
              >
                Close help
              </Button>
            </div>
            <dl className="shortcut-list">
              <div>
                <dt><kbd>Ctrl</kbd> + <kbd>K</kbd></dt>
                <dd>Open and focus Memory search</dd>
              </div>
              <div>
                <dt><kbd>Alt</kbd> + <kbd>H</kbd></dt>
                <dd>Open the Memory overview</dd>
              </div>
              <div>
                <dt><kbd>Alt</kbd> + <kbd>G</kbd></dt>
                <dd>Focus the relationship map selector</dd>
              </div>
              <div>
                <dt><kbd>Alt</kbd> + <kbd>C</kbd></dt>
                <dd>Toggle high contrast</dd>
              </div>
              <div>
                <dt><kbd>Alt</kbd> + <kbd>/</kbd></dt>
                <dd>Show or hide this help</dd>
              </div>
            </dl>
            <p className="shortcut-help-note">
              Every shortcut has a visible control. Shortcuts never replace
              standard keyboard navigation.
            </p>
          </section>
        ) : null}

        <Outlet />
        {shortcutStatus ? (
          <p className="visually-hidden" role="status" aria-live="polite">
            {shortcutStatus}
          </p>
        ) : null}
      </main>
      <footer className="site-footer">
        <p>
          StreamSense Live describes the current stream. StreamSense Memory
          keeps significant moments readable and searchable afterward.
        </p>
      </footer>
    </div>
  );
}

function readStoredHighContrast(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}
