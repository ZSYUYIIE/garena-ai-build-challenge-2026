import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

export function AppShell() {
  const location = useLocation();
  const initialLocation = useRef(location.pathname);

  useEffect(() => {
    if (initialLocation.current === location.pathname) {
      initialLocation.current = "";
      return;
    }
    const heading = document.querySelector<HTMLElement>("[data-route-heading]");
    heading?.focus();
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <NavLink className="brand" to="/" aria-label="StreamSense History home">
            <span className="brand-mark" aria-hidden="true">
              S
            </span>
            <span>
              <strong>StreamSense</strong>
              <small>History</small>
            </span>
          </NavLink>
          <nav aria-label="History navigation">
            <ul className="primary-navigation">
              <li>
                <NavLink to="/" end>
                  Sessions
                </NavLink>
              </li>
              <li>
                <NavLink to="/search">Search</NavLink>
              </li>
              <li>
                <NavLink to="/explore">Explore context</NavLink>
              </li>
            </ul>
          </nav>
        </div>
      </header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <p>
          StreamSense History keeps significant moments readable, searchable,
          and available outside the realtime viewing experience.
        </p>
      </footer>
    </div>
  );
}
