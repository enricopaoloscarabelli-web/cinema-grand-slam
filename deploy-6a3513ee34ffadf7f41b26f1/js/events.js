// ─────────────────────────────────────────────────────────────────────────
// Cinema Siqueiros — random festival events ("drama system")
//
// During a live simulation these fire at random and nudge a team's running
// score, producing broadcast-style highlights. Each event returns a delta in
// displayed points and a headline line for the live ticker.
//
// Events are deliberately varied — ovations, jury twists, soundtrack surges,
// iconic single-performer moments, critic backlashes, scandals — so the
// highlight reel never feels repetitive. They are applied to a UNIFORMLY
// random team (player included), so no team is ever favoured or punished.
//
// `scope` controls who the headline talks about:
//   "team" — the whole crew.
//   "char" — a single named crew member (the caller supplies the name).
// ─────────────────────────────────────────────────────────────────────────

export const EVENTS = [
  {
    id: "ovation",
    label: "Standing Ovation",
    icon: "👏",
    tone: "good",
    scope: "team",
    min: 18,
    max: 44,
    line: (t) => `${t} earns a thunderous standing ovation!`,
  },
  {
    id: "jury_twist",
    label: "Surprise Jury Twist",
    icon: "⚖️",
    tone: "good",
    scope: "team",
    min: 20,
    max: 48,
    line: (t) => `A surprise jury twist swings the ranking toward ${t}!`,
  },
  {
    id: "soundtrack",
    label: "Soundtrack Surge",
    icon: "🎵",
    tone: "good",
    scope: "team",
    min: 16,
    max: 38,
    line: (t) => `A soundtrack surge swells — the composer steals the show for ${t}.`,
  },
  {
    id: "performance",
    label: "Iconic Performance",
    icon: "🎭",
    tone: "good",
    scope: "char",
    min: 18,
    max: 42,
    line: (t, who) =>
      who
        ? `${who} delivers an iconic moment that lifts ${t}.`
        : `A career-defining performance lifts ${t}.`,
  },
  {
    id: "breakout",
    label: "Breakout Moment",
    icon: "🌟",
    tone: "good",
    scope: "char",
    min: 14,
    max: 34,
    line: (t, who) =>
      who
        ? `${who} dazzles the gala — a breakout moment for ${t}.`
        : `A breakout turn dazzles the gala for ${t}.`,
  },
  {
    id: "restoration",
    label: "Rapturous Reception",
    icon: "🎞️",
    tone: "good",
    scope: "team",
    min: 12,
    max: 30,
    line: (t) => `Critics rave on the way out — ${t} rides a wave of buzz.`,
  },
  {
    id: "backlash",
    label: "Critic Backlash",
    icon: "📉",
    tone: "bad",
    scope: "team",
    min: 14,
    max: 36,
    line: (t) => `Unexpected critic backlash drags ${t} down the board.`,
  },
  {
    id: "scandal",
    label: "Backstage Scandal",
    icon: "💣",
    tone: "bad",
    scope: "team",
    min: 12,
    max: 34,
    line: (t) => `A backstage scandal erupts around ${t}…`,
  },
  {
    id: "review",
    label: "Scathing Review",
    icon: "🗞️",
    tone: "bad",
    scope: "team",
    min: 10,
    max: 28,
    line: (t) => `A vicious critic walks out on ${t}.`,
  },
  {
    id: "walkout",
    label: "Mid-screening Walkout",
    icon: "🚪",
    tone: "bad",
    scope: "team",
    min: 10,
    max: 26,
    line: (t) => `A mid-screening walkout rattles ${t}.`,
  },
];

// Pick a weighted-random event (slightly biased toward positive drama so the
// reel skews celebratory, but every team is equally eligible to be the target).
export function rollEvent(rng) {
  const pool = EVENTS.filter((e) => (e.tone === "bad" ? rng() < 0.5 : true));
  return pool[Math.floor(rng() * pool.length)];
}

export function eventDelta(event, rng) {
  const magnitude = event.min + rng() * (event.max - event.min);
  return event.tone === "bad" ? -magnitude : magnitude;
}
