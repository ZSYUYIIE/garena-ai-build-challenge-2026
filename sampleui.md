# Early Side-Panel UI Concept (Historical)

This ASCII mockup predates the current StreamSense Live implementation. Names,
controls, replay actions, narration levels, and layout below are exploratory
only; they are not supported behavior or an acceptance specification. See
[`chrome-extension/README.md`](chrome-extension/README.md) for the current
side-panel contract.

```text
┌─────────────────────────────────────────────────────────────────┐
│  VISION CO-PILOT                   [ 🔴 LIVE ] [ End Session ]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ 🔊 AUDIO NARRATION LEVEL                                        │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ (•) MINIMAL    ( ) STANDARD    ( ) DETAILED    ( ) SILENT   │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ 📜 STREAM EVENTS TIMELINE (Live Announcements On)                │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ⚡ 02:14 — DOUBLE KILL                                      │ │
│ │ "Player 9 eliminated Player 2 and Player 3 near Baron."     │ │
│ │                                                             │ │
│ │ [ ↺ Replay (02:10) ]   [ 🔊 Read Aloud ]                    │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 🎯 01:45 — OBJECTIVE SECURED                                │ │
│ │ "Team Blue secured the Dragon."                             │ │
│ │                                                             │ │
│ │ [ ↺ Replay (01:40) ]   [ 🔊 Read Aloud ]                    │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ 💬 ASK CO-PILOT                                                 │
│ ┌───────────────────────────────────────────────┬─────────────┐ │
│ │ e.g. "Replay last kill by Player 9"           │  [ ASK ]    │ │
│ └───────────────────────────────────────────────┴─────────────┘ │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 💡 ANSWER: Player 9 secured a double kill at 02:14.          │ │
│ │ [ ↺ Jump To Moment (02:10) ]                                │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```
