import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import {
  errorMessage,
  isUnavailableError,
} from "../../api/apiError";
import { historyClient } from "../../api/historyClient";
import type { SearchRequest } from "../../api/contracts";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "../../components/AsyncState";
import { DemoDataBanner } from "../../components/DemoDataBanner";
import { Button, Input, Label } from "../../components/StreamSenseUi";
import { TagList } from "../../components/TagList";
import { formatPercent, humanizeEventType } from "../../lib/format";

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const searchMutation = useMutation({
    mutationFn: (request: SearchRequest) => historyClient.search(request),
  });

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) return;

    setSubmittedQuery(trimmedQuery);
    searchMutation.mutate({
      query: trimmedQuery,
      limit: 20,
    });
  };

  const response = searchMutation.data;
  const unavailable =
    (searchMutation.isError && isUnavailableError(searchMutation.error)) ||
    response?.retrievalMode === "unavailable";

  return (
    <div className="page-stack">
      <header className="page-header">
        <p className="eyebrow">Across previous sessions</p>
        <h1 data-route-heading tabIndex={-1}>
          Search meaningful moments
        </h1>
        <p className="lede">
          Ask for an event, entity, topic, or similar situation. Include context
          such as “football,” “wildlife,” or “esports” directly in the query when
          it matters. StreamSense searches only durable session summaries and
          significant events.
        </p>
      </header>

      <form className="search-panel" role="search" onSubmit={submitSearch}>
        <div className="field field-grow">
          <Label htmlFor="history-query">What are you looking for?</Label>
          <Input
            id="history-query"
            name="query"
            type="search"
            minLength={2}
            maxLength={500}
            required
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="For example, football counterattacks or owls feeding in snow"
          />
          <p className="field-hint">
            Describe the moment naturally; no separate domain field is required.
          </p>
        </div>
        <Button
          className="search-button"
          size="lg"
          type="submit"
          isDisabled={searchMutation.isPending || query.trim().length < 2}
        >
          Search history
        </Button>
      </form>

      <DemoDataBanner dataOrigin={response?.meta.dataOrigin ?? null} />

      <section aria-labelledby="search-results-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Search results</p>
            <h2 id="search-results-heading">
              {submittedQuery ? `Matches for “${submittedQuery}”` : "Ready to search"}
            </h2>
          </div>
        </div>

        {searchMutation.isPending ? (
          <LoadingState label="Searching previous sessions…" />
        ) : unavailable ? (
          <UnavailableState title="Semantic search is temporarily unavailable">
            <p>
              Previous sessions and their timelines still work. Try again when
              the history search service is configured.
            </p>
            {response?.warning ? <p>{response.warning}</p> : null}
          </UnavailableState>
        ) : searchMutation.isError ? (
          <ErrorState
            title="Search could not be completed"
            message={errorMessage(searchMutation.error)}
            onRetry={() => {
              if (submittedQuery) {
                searchMutation.mutate({
                  query: submittedQuery,
                  limit: 20,
                });
              }
            }}
          />
        ) : !response ? (
          <p className="quiet-copy">
            Search results will appear here. No video, audio, or partial
            transcript content is searched.
          </p>
        ) : response.results.length === 0 ? (
          <EmptyState
            title={
              response.meta.dataOrigin === "empty"
                ? "No saved moments yet"
                : "No matching moments"
            }
          >
            <p>
              {response.meta.dataOrigin === "empty"
                ? "Start StreamSense Live from the Chrome extension and let it save a significant moment. It will become searchable here after the backend archives and indexes it."
                : "Try a broader description, a visible subject, a person, or a team name."}
            </p>
          </EmptyState>
        ) : (
          <>
            {response.retrievalMode === "text" ? (
              <p className="mode-notice" role="status">
                Showing text and metadata matches because semantic retrieval is
                not active for this request.
              </p>
            ) : null}
            {response.warning ? (
              <p className="mode-notice" role="status">
                {response.warning}
              </p>
            ) : null}
            <ol className="search-results">
              {response.results.map((result) => (
                <li key={`${result.sessionId}:${result.eventId}`}>
                  <article className="search-result">
                    <div className="search-result-heading">
                      <div>
                        <p className="result-context">
                          {result.sessionTitle ?? "Saved session"} · {result.timestamp}
                        </p>
                        <h3>{humanizeEventType(result.eventType)}</h3>
                      </div>
                      {result.similarity !== null ? (
                        <span>{formatPercent(result.similarity)} similar</span>
                      ) : null}
                    </div>
                    <p>{result.description}</p>
                    <TagList label="Entities" values={result.entities} />
                    <TagList label="Topics" values={result.topics} />
                    <Link
                      className="text-link"
                      to={`/sessions/${result.sessionId}#event-${result.eventId}`}
                    >
                      Open this moment in its session
                    </Link>
                  </article>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}
