// ─────────────────────────────────────────────────────────────────────────
// Cinema Siqueiros — festivals + scoring engine
//
// A "team" is a map of role -> { name, rating, bonuses }. The player's crew
// and every AI roster are scored with the same model so results are fair.
//
// Each festival weights the seven craft components plus the three special
// bonuses differently. Scores are normalised to a 0–100 "performance" and
// displayed x10 (so ~0–1000) for a broadcast feel. A festival's performance
// is split across three acts that mirror how a screening actually unfolds.
// ─────────────────────────────────────────────────────────────────────────

import { ROLES } from "./data.js";

export const DIRECTOR_ROLES = [
  "Drama Director",
  "Comedy Director",
  "Genre Director",
  "STAR Director",
];
export const ACTOR_ROLES = [
  "STAR Actor",
  "Comedy Actor",
  "Drama Actor",
  "Character Actor",
  "Comedy Actress",
  "Drama Actress",
  "STAR Actress",
  "Character Actress",
];
export const STAR_ROLES = ["STAR Actor", "STAR Actress"];
export const DRAMA_ROLES = ["Drama Actor", "Drama Actress"];

// Which act each scoring component is revealed in.
// Act 1 — Film Introduction: directing + cast introduction.
// Act 2 — Technical Critique: screenplay + cinematography + music.
// Act 3 — Audience Reaction: STAR actors + emotional impact + cultural bonuses.
export const ACTS = [
  { id: 1, name: "Film Introduction", blurb: "Directing & cast introduction" },
  { id: 2, name: "Technical Critique", blurb: "Screenplay, cinematography & score" },
  { id: 3, name: "Audience Reaction", blurb: "STAR power & emotional impact" },
];

const COMPONENT_ACT = {
  directing: 1,
  acting: 1,
  screenplay: 2,
  cinematography: 2,
  music: 2,
  star: 3,
  drama: 3,
  political: 3,
  avantgarde: 3,
  hipster: 3,
  starsystem: 3,
  auteur: 3,
  social: 3,
};

// Every festival rewards exactly one of the six cultural bonuses. This map is
// surfaced on the draft screen so players can plan their crew strategically.
export const FESTIVAL_BONUS = {
  cannes: "social",
  venice: "auteur",
  berlin: "political",
  oscars: "starsystem",
  locarno: "avantgarde",
  sundance: "hipster",
};

export const FESTIVALS = [
  {
    key: "cannes",
    name: "Cannes",
    city: "France",
    icon: "🌴",
    accent: "#e7c66b",
    guidance: "The Palme jury worships DIRECTING & cinematography — and rewards the SOCIAL-ENGAGEMENT bonus.",
    reward: "Directing & cinematography",
    // Bonus weight reduced: social 3→2. Craft scores (directing, cine) more decisive.
    weights: { social: 2.5, directing: 2.5, cinematography: 1.8, screenplay: 1, acting: 0.8 },
  },
  {
    key: "venice",
    name: "Venice",
    city: "Italy",
    icon: "🦁",
    accent: "#c9a24a",
    guidance: "The Golden Lion rewards the SCREENPLAY, the score and the AUTEUR bonus.",
    reward: "Screenplay & score",
    // auteur 3→2. Screenplay and music more decisive.
    weights: { auteur: 2, screenplay: 2.5, music: 1.8, directing: 1, acting: 0.8 },
  },
  {
    key: "berlin",
    name: "Berlin",
    city: "Germany",
    icon: "🐻",
    accent: "#d98a8a",
    guidance: "The Bear favours films with a strong POLITICAL bonus — but directing and drama count too.",
    reward: "Political voices",
    // political 3.5→2.5. Drama and directing more impactful now.
    weights: { political: 2.5, directing: 1.5, acting: 1.2, screenplay: 1.2, drama: 1.2 },
  },
  {
    key: "oscars",
    name: "Oscars",
    city: "USA",
    icon: "🏆",
    accent: "#f0d27a",
    guidance: "The Academy is dazzled by ACTING and the STAR-SYSTEM bonus.",
    reward: "Acting & star power",
    // starsystem 3→2, star 1.5→1.2. Acting is now clearly king.
    weights: { starsystem: 2, acting: 2.5, star: 1.2, directing: 1, music: 1 },
  },
  {
    key: "locarno",
    name: "Locarno",
    city: "Switzerland",
    icon: "🐆",
    accent: "#9ec7e0",
    guidance: "The Leopard chases the AVANT-GARDE bonus — but craft still matters.",
    reward: "Avant-garde daring",
    // avantgarde 3.5→2.5. Directing and screenplay more relevant.
    weights: { avantgarde: 2.5, directing: 1.5, screenplay: 1.2, cinematography: 1.2, acting: 0.8 },
  },
  {
    key: "sundance",
    name: "Sundance",
    city: "USA",
    icon: "⛰️",
    accent: "#a8d8c0",
    guidance: "The indie crowd lives for the HIPSTER bonus — but your screenplay and acting must deliver.",
    reward: "Indie / hipster cred",
    // hipster 3.5→2.5. Screenplay and acting now real factors.
    weights: { hipster: 2.5, directing: 1.2, acting: 1.5, screenplay: 1.5, music: 0.8 },
  },
];

// ── GOAT AWARDS — the final boss festival ────────────────────────────────
// Weights every component equally: no single bonus or craft dominates.
// This is the hardest possible jury to please.
export const GOAT_FESTIVAL = {
  key: "goat",
  name: "GOAT Awards",
  city: "Cinema History",
  icon: "🐐",
  accent: "#c0a060",
  guidance: "The GOAT jury rewards everything equally. There are no shortcuts.",
  reward: "All components · all bonuses",
  weights: {
    directing: 1.5,
    acting: 1.5,
    screenplay: 1.5,
    cinematography: 1.5,
    music: 1.5,
    star: 1,
    drama: 1,
    political: 1,
    avantgarde: 1,
    hipster: 1,
    starsystem: 1,
    auteur: 1,
    social: 1,
  },
};

function avg(team, roles) {
  const vals = roles.map((r) => (team[r] ? team[r].rating : 0));
  const present = vals.filter((v) => v > 0);
  if (present.length === 0) return 0;
  // Missing roles are penalised: divide by the full role count, not the present count.
  return vals.reduce((a, b) => a + b, 0) / roles.length;
}

function bonusStrength(team, type, divisor) {
  let sum = 0;
  for (const role of ROLES) {
    const m = team[role];
    if (m && m.bonuses.includes(type)) sum += m.rating;
  }
  return Math.min(100, sum / divisor);
}

// Raw 0–100 value of every scoring component for a team.
// Divisors for bonus strength: higher = harder to max out a bonus.
// Previously avantgarde/hipster used 3 (too easy to stack), now raised to 5.
// political/starsystem raised from 6 → 8; auteur/social from 4 → 6.
// Easy Mode restores the original low divisors for stronger bonuses.
export function components(team, easyMode = false) {
  return {
    directing: avg(team, DIRECTOR_ROLES),
    acting: avg(team, ACTOR_ROLES),
    star: avg(team, STAR_ROLES),
    screenplay: team["Screenwriter"] ? team["Screenwriter"].rating : 0,
    cinematography: team["Cinematographer"] ? team["Cinematographer"].rating : 0,
    music: team["Composer"] ? team["Composer"].rating : 0,
    drama: avg(team, DRAMA_ROLES),
    political:   bonusStrength(team, "political",   easyMode ? 7 : 7),
    avantgarde:  bonusStrength(team, "avantgarde",  easyMode ? 4 : 4),
    hipster:     bonusStrength(team, "hipster",     easyMode ? 4 : 4),
    starsystem:  bonusStrength(team, "starsystem",  easyMode ? 7 : 7),
    auteur:      bonusStrength(team, "auteur",      easyMode ? 5 : 5),
    social:      bonusStrength(team, "social",      easyMode ? 5 : 5),
  };
}

// Returns { total, acts: [a1, a2, a3] } — all on the displayed x10 scale.
export function scoreBreakdown(team, festival, easyMode = false) {
  const comp = components(team, easyMode);
  const w = festival.weights;
  const actSums = [0, 0, 0];
  let weightTotal = 0;
  for (const key of Object.keys(w)) {
    const weight = w[key];
    weightTotal += weight;
    const contribution = weight * (comp[key] || 0);
    actSums[COMPONENT_ACT[key] - 1] += contribution;
  }
  const acts = actSums.map((s) => (weightTotal ? (s / weightTotal) * 10 : 0));
  return { total: acts.reduce((a, b) => a + b, 0), acts, components: comp };
}

// Convenience: list a team's members that carry a given bonus.
export function bonusHolders(team, type) {
  return ROLES.map((r) => team[r]).filter((m) => m && m.bonuses.includes(type));
}

// Average rating of a team (map of role -> member). Missing roles count as 0
// so incomplete rosters read as weaker — matching how scoring penalises gaps.
export function teamAverage(team) {
  const total = ROLES.reduce((a, r) => a + (team[r] ? team[r].rating : 0), 0);
  return total / ROLES.length;
}

// The bonus "departments" a team carries, with how many members supply each —
// used for the pre-match strength tags. Returns e.g. [{type:"political",count:3}].
export function bonusTags(team) {
  return ["political", "avantgarde", "hipster", "starsystem", "auteur", "social"]
    .map((type) => ({ type, count: bonusHolders(team, type).length }))
    .filter((b) => b.count > 0);
}
