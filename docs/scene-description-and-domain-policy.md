# Scene-first narration and optional domain metadata

## Product rule

StreamSense narration exists to communicate visual information that a blind or
low-vision viewer cannot obtain from the page title, player controls, ordinary
screen-reader output, or commentary alone.

Descriptions therefore lead with the primary video scene:

- visible people, animals, and objects;
- reliable counts;
- actions and body positions;
- spatial relationships and setting;
- consequential visual changes;
- visually missing sports context such as formation, pressure, location,
  reactions, and off-ball movement.

Platform/page names, video titles, channel names, filenames, captions,
subtitles, and static scoreboards are surrounding metadata. A changed title or
score may be included only as brief secondary context after the visual scene
when it materially changes understanding.

Good:

> Two adult owls and three chicks feed on prey on a patch of snow.

Rejected:

> A YouTube video page is displayed featuring a wildlife video titled Rare
> Wildlife.

The prompt applies this rule to both automatic narration and persisted event
descriptions. A deterministic backend guard also rejects wrapper-only page/title
descriptions before they can enter the timeline.

## Domain metadata

The current realtime handshake cannot reliably know an entertainment domain,
so sessions may retain the internal compatibility value `unknown`. Memory must
not present that value as meaningful information.

The dashboard therefore:

- hides `unknown` and `unclassified` domain labels;
- hides the domain graph filter when no reliable domain is available;
- does not require a separate domain field for semantic search;
- asks users to include useful context directly in a natural-language query,
  such as `football counterattacks` or `owls feeding in snow`.

Known domain metadata remains supported for real sessions that are explicitly
classified or imported with trustworthy metadata. It is not required for
search, timelines, or the session relationship view.

## Current capture limitation

The extension currently analyzes the captured tab frame rather than a guaranteed
crop of the underlying HTML video element. The scene-first prompt and rejection
guard reduce page-wrapper narration without adding fragile site-specific DOM
logic. If physical testing still shows persistent page-title bias on specific
sites, the next isolated improvement is a best-effort largest-visible-video crop
with a safe full-frame fallback.
