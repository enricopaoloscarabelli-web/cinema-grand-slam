// ─────────────────────────────────────────────────────────────────────────
// Cinema Siqueiros — game controller
//
// A small state machine that drives every screen: title → draft → crew
// complete → festival circuit (live simulation) → season transfers →
// final standings. No framework; screens render into #app and the live
// simulation mutates specific nodes by reference.
// ─────────────────────────────────────────────────────────────────────────

import { ROSTERS, ROLES, BONUS_LABELS, GOAT_TEAM } from "./data.js";
import {
  FESTIVALS,
  FESTIVAL_BONUS,
  ACTS,
  scoreBreakdown,
  teamAverage,
  bonusTags,
  GOAT_FESTIVAL,
} from "./festivals.js";
import { rollEvent, eventDelta } from "./events.js";
import { DECISIONS } from "./decisions.js";

// ── SUPABASE LEADERBOARD ──────────────────────────────────────────────────
const SUPABASE_URL = "https://jqiqwodzqpjdqqbnovjw.supabase.co";
const SUPABASE_KEY = "sb_publishable_SWXsqqRBd1Zru8tfnUiCVQ_r0ep_R92";

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": options.prefer || "",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  return res.json().catch(() => null);
}

async function submitScore(playerName, score, festivalsWon, grandSlam) {
  try {
    let actualDifficulty = "normal";
    if (typeof game !== "undefined") {
      if (game.isEasyMode) {
        actualDifficulty = "dummies";
      } else if (game.isExpertMode) {
        actualDifficulty = "master";
      }
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/leaderboard`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        player_name: playerName.trim().slice(0, 30),
        score: parseInt(score, 10),
        festivals_won: festivalsWon,
        grand_slam: grandSlam,
        difficulty: actualDifficulty
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return true;
  } catch (e) {
    console.error("Score submit failed:", e);
    return false;
  }
}

async function fetchLeaderboard(difficulty = "dummies") {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/leaderboard?select=player_name,score,festivals_won,grand_slam,created_at&difficulty=eq.${difficulty.toLowerCase()}&order=score.desc&limit=15`,
      {
        method: "GET",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data || [];
  } catch (e) {
    console.error("Leaderboard fetch failed:", e);
    return [];
  }
}

const TOTAL_SEASONS = 3;
const REEL_ITEM_H = 92; // keep in sync with .reel-item height in CSS

// Festival lookup by key (name / icon / accent for decision + reputation UI).
const FEST_BY_KEY = Object.fromEntries(FESTIVALS.map((f) => [f.key, f]));

// ── tiny helpers ─────────────────────────────────────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const fmt = (n) => Math.round(n).toLocaleString("en-US");

// ── CONFETTI & FIREWORKS ──────────────────────────────────────────────────
// Pure CSS + JS canvas-free confetti. Uses absolutely-positioned divs that
// animate with CSS keyframes injected once, then fall and fade out.
// `intensity`: "festival" (win) | "slam" (grand slam) | "goat" (goat win)

let _confettiStyleInjected = false;

function injectConfettiStyles() {
  if (_confettiStyleInjected) return;
  _confettiStyleInjected = true;
  const s = document.createElement("style");
  s.textContent = `
    .confetti-piece {
      position: fixed;
      top: -12px;
      width: 10px;
      height: 14px;
      border-radius: 2px;
      opacity: 0;
      pointer-events: none;
      z-index: 99998;
      animation: confettiFall linear forwards;
    }
    @keyframes confettiFall {
      0%   { opacity: 1; transform: translateY(0) rotate(0deg) scaleX(1); }
      80%  { opacity: 1; }
      100% { opacity: 0; transform: translateY(105vh) rotate(720deg) scaleX(-1); }
    }
    .firework {
      position: fixed;
      pointer-events: none;
      z-index: 99998;
    }
    .firework-spark {
      position: absolute;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      animation: sparkFly ease-out forwards;
    }
    @keyframes sparkFly {
      0%   { transform: translate(0,0) scale(1); opacity: 1; }
      100% { transform: translate(var(--tx), var(--ty)) scale(0); opacity: 0; }
    }
  `;
  document.head.appendChild(s);
}

function launchConfetti(intensity = "festival") {
  injectConfettiStyles();
  const counts = { festival: 80, slam: 180, goat: 140 };
  const durations = { festival: [1800, 3200], slam: [2000, 4000], goat: [1900, 3500] };
  const palettes = {
    festival: ["#e7c66b", "#f0d27a", "#fff", "#6fcf97", "#8bb7df", "#b48ce0"],
    slam:     ["#e7c66b", "#f0d27a", "#fff", "#ffd700", "#ff9d00", "#ffe066"],
    goat:     ["#b48ce0", "#d9b6ff", "#fff", "#e7c66b", "#8a5fc7", "#cfcbc0"],
  };

  const count = counts[intensity];
  const [dMin, dMax] = durations[intensity];
  const colors = palettes[intensity];
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99998;overflow:hidden;";
  document.body.appendChild(container);

  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    const color = colors[Math.floor(Math.random() * colors.length)];
    const left = Math.random() * 100;
    const delay = Math.random() * 1200;
    const dur = dMin + Math.random() * (dMax - dMin);
    const size = 7 + Math.random() * 9;
    piece.style.cssText = `
      left:${left}%;
      background:${color};
      width:${size}px;
      height:${size * 1.4}px;
      animation-duration:${dur}ms;
      animation-delay:${delay}ms;
    `;
    container.appendChild(piece);
  }

  // Fireworks bursts for slam/goat
  if (intensity !== "festival") {
    const burstCount = intensity === "slam" ? 6 : 4;
    for (let b = 0; b < burstCount; b++) {
      setTimeout(() => {
        const fw = document.createElement("div");
        fw.className = "firework";
        const x = 10 + Math.random() * 80;
        const y = 5 + Math.random() * 50;
        fw.style.cssText = `left:${x}%;top:${y}%;`;
        const sparkColors = palettes[intensity];
        for (let s = 0; s < 20; s++) {
          const spark = document.createElement("div");
          spark.className = "firework-spark";
          const angle = (s / 20) * Math.PI * 2;
          const dist = 60 + Math.random() * 80;
          spark.style.cssText = `
            background:${sparkColors[s % sparkColors.length]};
            --tx:${Math.cos(angle) * dist}px;
            --ty:${Math.sin(angle) * dist}px;
            animation-duration:${600 + Math.random() * 500}ms;
            animation-delay:${Math.random() * 200}ms;
          `;
          fw.appendChild(spark);
        }
        document.body.appendChild(fw);
        setTimeout(() => fw.remove(), 1200);
      }, b * 350 + Math.random() * 200);
    }
  }

  // Clean up after animation completes
  setTimeout(() => container.remove(), dMax + 1400);
}
// Uses Web Audio API — no files, no dependencies. Creates a mechanical
// clicking sound that speeds up at the start and slows to a stop, like a
// real slot machine reel. Gracefully silenced if the browser blocks audio.
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
  }
  return _audioCtx;
}

function playClick(ctx, time, gain = 0.18) {
  try {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.03, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      // Short noise burst — mechanical click feel
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 6);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const vol = ctx.createGain();
    vol.gain.value = gain;
    src.connect(vol);
    vol.connect(ctx.destination);
    src.start(time);
  } catch (_) {}
}

function playReelSound(durationMs) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  // Resume context if suspended (browser autoplay policy)
  if (ctx.state === "suspended") ctx.resume();

  const now = ctx.currentTime;
  const duration = durationMs / 1000;
  // Schedule clicks: fast at start, slow at end — matches the CSS ease-out curve
  // Interval goes from 55ms (fast spin) to 280ms (slow stop)
  let t = 0;
  let interval = 0.055; // seconds between clicks at start
  const endInterval = 0.28;
  while (t < duration) {
    playClick(ctx, now + t, t < duration * 0.15 ? 0.12 : 0.2);
    // Gradually increase interval (deceleration)
    const progress = t / duration;
    interval = 0.055 + (endInterval - 0.055) * Math.pow(progress, 1.8);
    t += interval;
  }
  // Final heavier "clunk" as it lands
  playClick(ctx, now + duration - 0.04, 0.35);
}

// Quality tier for a 0–100 rating, used to colour every numeric rating in the
// UI (gold > blue > green > orange > red). Returns a CSS class suffix; styling
// lives in styles.css under .rt-* so the palette stays in one place.
//   91–100 gold · 85–90 blue · 75–84 green · 65–74 orange · 0–64 red
function ratingTier(n) {
  const r = Math.round(n);
  if (r >= 90) return "gold";
  if (r >= 85) return "blue";
  if (r >= 75) return "green";
  if (r >= 65) return "orange";
  return "red";
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function rosterToTeam(roster) {
  const map = {};
  for (const m of roster.members) map[m.role] = m;
  return map;
}

const COMPLETE_ROSTERS = ROSTERS.filter((r) => r.missing.length === 0);

// ── game state ─────────────────────────────────────────────────────────────
const game = {
  crew: {}, // role -> member (member gets a `.from` roster name attached)
  pickedNames: new Set(),
  currentRoster: null,
  redrawsLeft: 1, // ONE discretionary redraw for the whole initial draft
  drawnThisTurn: false, // the "Draw Team" button is a one-shot per draw turn
  usedRosterIds: new Set(), // every roster ever generated this session — no repeats
  started: false, // career underway — controls the persistent roadmap bar
  season: 1,
  grandTotal: 0,
  seasonScores: [], // per-season player totals
  results: [], // flat list of festival result objects
  conquered: new Set(), // festival keys won at least once — permanent for the run
  transfersLeft: 0,
  mode: "draft", // "draft" | "transfer"
  festRivals: [], // the 4 AI teams for the current festival (fresh every festival)
  _seasonUsedRivalIds: new Set(), // rosters already used as rivals this season
  // Per-festival reputation — accumulated across the whole career via the
  // interactive decision events (see decisions.js). Each festival's reputation
  // is folded into the player's score at THAT festival, so a dilemma always
  // helps some festivals and hurts others.
  festivalRep: Object.fromEntries(FESTIVALS.map((f) => [f.key, 0])),
  usedDecisions: new Set(), // decision ids already shown this run (no repeats)
  isExpertMode: false, // Expert Mode: hide ratings/bonuses during the draft only
  isEasyMode: false,   // Easy Mode: unlimited redraws + original bonus values
  playerName: "Anonymous", // set at game start for the leaderboard
  _scoredKeys: new Set(), // anti-cheat: "S1-cannes" etc. — never score twice
};

// Resets every mutable piece of run state back to its initial value, while
// preserving the player's name and the difficulty they just picked on the
// intro screen. MUST be called before starting a brand-new career — without
// it, `game.crew` (and everything else) still holds whatever was drafted in
// a previous session, even after deleteSave(), because deleteSave() only
// clears localStorage and never touches the live `game` object in memory.
function resetGameState() {
  game.crew = {};
  game.pickedNames = new Set();
  game.currentRoster = null;
  game.redrawsLeft = 1;
  game.drawnThisTurn = false;
  game.usedRosterIds = new Set();
  game.started = false;
  game.season = 1;
  game.grandTotal = 0;
  game.seasonScores = [];
  game.results = [];
  game.conquered = new Set();
  game.transfersLeft = 0;
  game.mode = "draft";
  game.festRivals = [];
  game._seasonUsedRivalIds = new Set();
  game.festivalRep = Object.fromEntries(FESTIVALS.map((f) => [f.key, 0]));
  game.usedDecisions = new Set();
  game._festivalIndex = 0;
  game._seasonScore = 0;
  game._scoredKeys = new Set();
  // isExpertMode / isEasyMode / playerName are intentionally left untouched —
  // they reflect the choice the player just made on the intro screen.
}

// ── SAVE / LOAD (localStorage) ───────────────────────────────────────────
// Serialises the mutable game state to JSON and stores it under a fixed key.
// Sets containing strings (pickedNames, usedRosterIds, conquered, etc.) are
// converted to arrays for JSON, then restored on load.
// Called automatically after every meaningful state change.

const SAVE_KEY = "cgs_save_v1";

function saveGame() {
  try {
    const data = {
      crew: game.crew,
      pickedNames: [...game.pickedNames],
      usedRosterIds: [...game.usedRosterIds],
      started: game.started,
      season: game.season,
      grandTotal: game.grandTotal,
      seasonScores: game.seasonScores,
      results: game.results,
      conquered: [...game.conquered],
      transfersLeft: game.transfersLeft,
      mode: game.mode,
      _festivalIndex: game._festivalIndex || 0,
      _seasonScore: game._seasonScore || 0,
      festivalRep: game.festivalRep,
      usedDecisions: [...game.usedDecisions],
      isExpertMode: game.isExpertMode,
      isEasyMode: game.isEasyMode,
      redrawsLeft: game.redrawsLeft === Infinity ? "Infinity" : game.redrawsLeft,
      _scoredKeys: [...game._scoredKeys],
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (_) {}
}

function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch (_) { return false; }
}

function deleteSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (_) {}
}

function deleteSubmitKeys() {
  try {
    Object.keys(localStorage).filter(k => k.startsWith("cgs_submitted_")).forEach(k => localStorage.removeItem(k));
  } catch (_) {}
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    game.crew           = data.crew || {};
    game.pickedNames    = new Set(data.pickedNames || []);
    game.usedRosterIds  = new Set(data.usedRosterIds || []);
    game.started        = data.started || false;
    game.season         = data.season || 1;
    game.grandTotal     = data.grandTotal || 0;
    game.seasonScores   = data.seasonScores || [];
    game.results        = data.results || [];
    game.conquered      = new Set(data.conquered || []);
    game.transfersLeft  = data.transfersLeft || 0;
    game.mode           = data.mode || "draft";
    game._festivalIndex = data._festivalIndex || 0;
    game._seasonScore   = data._seasonScore || 0;
    game.festivalRep    = data.festivalRep || Object.fromEntries(FESTIVALS.map((f) => [f.key, 0]));
    game.usedDecisions  = new Set(data.usedDecisions || []);
    game.isExpertMode   = data.isExpertMode || false;
    game.isEasyMode     = data.isEasyMode || false;
    game.redrawsLeft    = data.redrawsLeft === "Infinity" ? Infinity : (data.redrawsLeft ?? 1);
    game._scoredKeys    = new Set(data._scoredKeys || []);
    return true;
  } catch (_) { return false; }
}
function ratingsHidden() {
  return game.isExpertMode && (game.mode === "draft" || game.mode === "transfer");
}

const root = () => $("#app");

// ── unique roster generation (no roster is ever drawn twice in a session) ────
function takeUniqueRoster(pool) {
  const fresh = pool.filter((r) => !game.usedRosterIds.has(r.id));
  const chosen = pick(fresh.length ? fresh : pool);
  game.usedRosterIds.add(chosen.id);
  return chosen;
}

// Pick `n` distinct AI rosters for one festival. Opponents change every festival:
// we prefer rosters not yet used as rivals this season (so different events feature
// different opponents), only allowing repeats once the season's pool is exhausted.
function pickFestivalRivals(n) {
  const used = game._seasonUsedRivalIds;
  let pool = COMPLETE_ROSTERS.filter((r) => !used.has(r.id));
  if (pool.length < n) {
    used.clear();
    pool = COMPLETE_ROSTERS.slice();
  } else {
    pool = pool.slice();
  }
  const out = [];
  while (out.length < n && pool.length) {
    const [r] = pool.splice(Math.floor(Math.random() * pool.length), 1);
    out.push(r);
    used.add(r.id);
  }
  return out;
}

// ── persistent "Road to the Cinema Grand Slam" bar ───────────────────────────
// The six majors a player must conquer. Always visible once a career begins; a
// festival's trophy lights up the moment it is won and stays lit for the run.
function renderRoadmap() {
  const bar = document.getElementById("roadmap");
  if (!bar) return;
  if (!game.started) {
    bar.classList.remove("show");
    bar.innerHTML = "";
    return;
  }
  const wonCount = FESTIVALS.filter((f) => game.conquered.has(f.key)).length;
  bar.classList.add("show");
  bar.innerHTML = `
    <div class="roadmap-inner">
      <button class="btn-home" id="homeBtn" title="Return to home screen">🏠</button>
      <span class="roadmap-title">🎯 Road to the Cinema Grand Slam <span class="roadmap-count">${wonCount}/${FESTIVALS.length}</span></span>
      <div class="roadmap-trophies">
        ${FESTIVALS.map((f) => {
          const won = game.conquered.has(f.key);
          return `<span class="rm-trophy ${won ? "won" : "todo"}">
            <span class="rm-icon">${won ? "🏆" : "🔒"}</span>
            <span class="rm-name">${f.name}</span>
          </span>`;
        }).join("")}
      </div>
    </div>`;
  bar.querySelector("#homeBtn").addEventListener("click", () => {
    if (confirm("Return to home? Your progress is saved.")) {
      renderIntro();
    }
  });
}

function crewSize() {
  return Object.keys(game.crew).length;
}
function crewComplete() {
  return ROLES.every((r) => game.crew[r]);
}
function crewRating() {
  const vals = Object.values(game.crew).map((m) => m.rating);
  return vals.reduce((a, b) => a + b, 0);
}
function crewAverage() {
  const n = crewSize();
  return n ? crewRating() / n : 0;
}

// Render a member's bonuses as readable labelled chips (never hidden/implicit).
function bonusChipsHTML(bonuses) {
  if (!bonuses.length) return "";
  return bonuses
    .map(
      (b) =>
        `<span class="bonus-tag bonus-${b}"><i class="bonus bonus-${b}"></i>${BONUS_LABELS[b] || b}</span>`
    )
    .join("");
}

// The festival evaluation guide, shown on the draft screen so players can plan
// a crew strategically: each festival rewards specific ratings AND one of the
// six cultural bonuses.
function festivalEvalHTML() {
  return `
    <div class="fest-eval">
      <p class="fest-eval-head"><b>🎯 How festivals score you.</b> Each of the six majors values
      different craft <i>and</i> rewards one special bonus. Build toward the festivals you mean to win.</p>
      <div class="fest-eval-grid">
        ${FESTIVALS.map((f) => {
          const bonus = FESTIVAL_BONUS[f.key];
          return `
            <div class="fe-card" style="--accent:${f.accent}">
              <span class="fe-icon">${f.icon}</span>
              <span class="fe-name">${f.name}</span>
              <span class="fe-reward">${f.reward}</span>
              <span class="bonus-tag bonus-${bonus}"><i class="bonus bonus-${bonus}"></i>${BONUS_LABELS[bonus]}</span>
            </div>`;
        }).join("")}
      </div>
    </div>`;
}

// ── producer reputation (decision-event outcomes) ──────────────────────────
// A decision effect is a map of festival-key -> points. The special key
// "target" resolves to whichever festival is next — used by lobbying dilemmas.
function resolveEffectKey(key) {
  return key === "target" ? currentFestival().key : key;
}

// Has the player accumulated any reputation anywhere?
function hasAnyRep() {
  return FESTIVALS.some((f) => game.festivalRep[f.key] !== 0);
}

// A compact strip of every festival the player currently carries reputation at.
function festivalRepHUDHTML() {
  const carried = FESTIVALS.filter((f) => game.festivalRep[f.key] !== 0);
  if (!carried.length)
    return `<p class="muted small">No festival reputation yet — your decisions will build it.</p>`;
  return `
    <div class="rep-hud" aria-label="Festival reputation">
      ${carried
        .map((f) => {
          const v = game.festivalRep[f.key];
          const cls = v > 0 ? "up" : "down";
          return `
            <div class="rep-pip ${cls}">
              <span class="rep-ic">${f.icon}</span>
              <span class="rep-lab">${f.name}</span>
              <span class="rep-val">${v > 0 ? "+" : ""}${v}</span>
            </div>`;
        })
        .join("")}
    </div>`;
}

// Render a decision choice's festival deltas (resolving the "target" token to
// the festival the player is about to compete in).
function effectChipsHTML(effect) {
  return Object.entries(effect)
    .map(([rawKey, v]) => {
      const f = FEST_BY_KEY[resolveEffectKey(rawKey)];
      const label = rawKey === "target" ? `${f.icon} ${f.name} (this fest)` : `${f.icon} ${f.name}`;
      return `<span class="eff ${v > 0 ? "up" : "down"}">${label} ${v > 0 ? "+" : ""}${v}</span>`;
    })
    .join("");
}

// ───────────────────────────────────────────────────────────────────────────
// SCREEN: title / intro
// ───────────────────────────────────────────────────────────────────────────
function renderIntro() {
  root().innerHTML = "";
  const view = el(`
    <section class="screen intro">
      <div class="intro-glow"></div>
      <p class="kicker">A cinema fantasy team builder &amp; tournament simulator</p>
      <h1 class="title">Cinema<span>Grand Slam</span></h1>
      <p class="lede">
        Build the greatest film crew in history and conquer every major film
        festival within three seasons. Win Cannes, Venice, Berlin, the Oscars,
        Sundance <em>and</em> Locarno to achieve the <b class="hl">Cinema Grand Slam</b>.
      </p>
      <div class="player-name-box">
        <label class="player-name-label" for="playerNameInput">🎬 Your name for the leaderboard</label>
        <input class="player-name-input" id="playerNameInput" type="text" maxlength="30" placeholder="Enter your name..." autocomplete="off" />
      </div>
      <button class="btn btn-primary btn-xl" id="begin">🎬 Begin Career</button>
      ${hasSave() ? `<button class="btn btn-resume btn-xl" id="resume">▶ Continue saved career</button>` : ""}
      <button class="btn btn-ghost" id="showLeaderboard">🏆 Global Leaderboard</button>
      <div class="mode-select" id="modeSelect" role="group" aria-label="Game mode">
        <button class="mode-btn" data-mode="easy">
          <span class="mode-name">🍿 Cinema for dummies (Nolan fan)</span>
          <span class="mode-desc">Unlimited redraws. Stronger bonuses. For beginners.</span>
        </button>
        <button class="mode-btn" data-mode="normal">
          <span class="mode-name">🎟️ Cinema expert (Kiarostami fan)</span>
          <span class="mode-desc">Ratings &amp; bonuses always visible. One redraw.</span>
        </button>
        <button class="mode-btn" data-mode="expert">
          <span class="mode-name">🕶️ Cinema master (The Emperor's New Groove fan)</span>
          <span class="mode-desc">Ratings &amp; bonuses hidden until your crew is complete.</span>
        </button>
      </div>
      <p class="nolan-note"><i>Hey, Nolan fans, don't take it personally, we're just joking. Or maybe not? Who knows.</i></p>
      <div class="intro-fests">
        ${FESTIVALS.map((f) => `<span class="chip" style="--accent:${f.accent}">${f.icon} ${f.name}</span>`).join("")}
      </div>
    </section>
  `);
  view.querySelector("#begin").addEventListener("click", () => {
    const nameInput = view.querySelector("#playerNameInput");
    game.playerName = nameInput && nameInput.value.trim() ? nameInput.value.trim() : "Anonymous";
    deleteSave();
    deleteSubmitKeys();
    resetGameState();
    startDraftTurn();
  });
  const resumeBtn = view.querySelector("#resume");
  if (resumeBtn) {
    resumeBtn.addEventListener("click", () => {
      const nameInput = view.querySelector("#playerNameInput");
      if (nameInput && nameInput.value.trim()) game.playerName = nameInput.value.trim();
      if (loadGame()) {
        renderRoadmap();
        resumeFromSave();
      }
    });
  }
  view.querySelector("#showLeaderboard").addEventListener("click", () => renderLeaderboardScreen());
  const modeSelect = view.querySelector("#modeSelect");
  const syncMode = () => {
    modeSelect.querySelectorAll(".mode-btn").forEach((btn) => {
      const m = btn.dataset.mode;
      const active =
        (m === "easy" && game.isEasyMode) ||
        (m === "expert" && game.isExpertMode) ||
        (m === "normal" && !game.isEasyMode && !game.isExpertMode);
      btn.classList.toggle("active", active);
    });
  };
  modeSelect.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      game.isEasyMode   = btn.dataset.mode === "easy";
      game.isExpertMode = btn.dataset.mode === "expert";
      syncMode();
    });
  });
  syncMode();
  root().appendChild(view);
}

// ───────────────────────────────────────────────────────────────────────────
// SCREEN: draft (and transfers, which reuse the same machinery)
// ───────────────────────────────────────────────────────────────────────────
function startDraftTurn() {
  game.mode = "draft";
  game.redrawsLeft = game.isEasyMode ? Infinity : 1;
  game.started = true;
  saveGame();
  renderRoadmap();
  renderDraft();
}

// Resume a saved career at the right screen based on saved state.
function resumeFromSave() {
  if (!game.started) { renderIntro(); return; }
  if (crewComplete()) {
    // Crew is done — resume at the right point in the season circuit
    if (game.mode === "transfer") {
      renderDraft();
    } else if (game._festivalIndex < FESTIVALS.length) {
      enterFestival();
    } else {
      renderSeasonEnd();
    }
  } else {
    // Still drafting
    renderDraft();
  }
}

function renderDraft() {
  const transfer = game.mode === "transfer";
  game.drawnThisTurn = false; // a fresh turn — the one-shot Draw button is armed again
  root().innerHTML = "";
  const filled = crewSize();
  const avg = crewAverage();
  const view = el(`
    <section class="screen draft">
      <header class="draft-head">
        <div>
          <p class="kicker">${transfer ? `Season ${game.season} — Transfer window` : "Draft phase"}</p>
          <h2>${transfer ? `Replace up to 2 crew members` : `Build your crew`}</h2>
        </div>
        <div class="draft-stats">
          <div class="draft-stat">
            <span class="big">${filled}<span class="muted">/15</span></span>
            <span class="muted">roles filled</span>
          </div>
          <div class="draft-stat" id="crewAvgStat">
            <span class="big ${filled && !ratingsHidden() ? `rt-${ratingTier(avg)}` : ""}">${
              ratingsHidden() ? "🔒" : filled ? avg.toFixed(1) : "—"
            }</span>
            <span class="muted">crew avg rating</span>
          </div>
        </div>
      </header>

      <p class="bonus-note">
        <b>N.B. Bonus System:</b> some characters carry special bonuses
        <span class="bonus-tag bonus-political"><i class="bonus bonus-political"></i>Political</span>
        <span class="bonus-tag bonus-social"><i class="bonus bonus-social"></i>Social Engagement</span>
        <span class="bonus-tag bonus-auteur"><i class="bonus bonus-auteur"></i>Auteur</span>
        <span class="bonus-tag bonus-starsystem"><i class="bonus bonus-starsystem"></i>Star System</span>
        <span class="bonus-tag bonus-hipster"><i class="bonus bonus-hipster"></i>Hipster</span>
        <span class="bonus-tag bonus-avantgarde"><i class="bonus bonus-avantgarde"></i>Avant-garde</span>.
        Each festival values a different style of cinema, so a balanced crew is strategic.
      </p>

      ${
        ratingsHidden()
          ? `<p class="expert-banner">🕶️ <b>Cinema master</b> — ratings &amp; bonuses are hidden while you draft. Trust your instincts; everything is revealed once your crew is complete.</p>`
          : game.isEasyMode
          ? `<p class="easy-banner">🍿 <b>Cinema for dummies</b> — unlimited redraws and stronger bonuses. Take your time building the perfect crew.</p>`
          : ""
      }

      ${festivalEvalHTML()}

      <div class="draft-stage">
        <div class="reel-wrap" id="reelWrap">
          <div class="reel-window">
            <div class="reel-strip" id="reelStrip"></div>
            <div class="reel-line"></div>
          </div>
          <p class="reel-caption" id="reelCaption">
            ${transfer
              ? `You have <b>${game.transfersLeft}</b> draw${game.transfersLeft === 1 ? "" : "s"} left.`
              : `Spin the reel to draw a historical roster.`}
          </p>
          <div class="draft-actions">
            <button class="btn btn-primary btn-lg" id="drawBtn" ${
              (transfer && game.transfersLeft <= 0) || game.drawnThisTurn ? "disabled" : ""
            }>🎰 Draw Team</button>
            ${transfer ? `<button class="btn btn-ghost" id="doneTransfer">Done — start Season ${game.season} ▸</button>` : ""}
          </div>
        </div>
        <aside class="roster-pane" id="rosterPane"></aside>
      </div>

      ${renderCrewStripHTML()}

      <p class="draft-disclaimer">Not happy with the ratings? I don't care. Go build your own cinema game with blackjack and hookers.</p>
    </section>
  `);
  buildReelStrip(view.querySelector("#reelStrip"), game.currentRoster);
  view.querySelector("#drawBtn").addEventListener("click", () => drawTeam());
  const doneBtn = view.querySelector("#doneTransfer");
  if (doneBtn) doneBtn.addEventListener("click", () => beginSeason());
  root().appendChild(view);

  if (game.currentRoster) renderRosterPane(game.currentRoster);
}

function renderCrewStripHTML() {
  const hide = ratingsHidden();
  return `
    <div class="crew-strip">
      ${ROLES.map((role) => {
        const m = game.crew[role];
        return `
          <div class="crew-slot ${m ? "filled" : "empty"}">
            <div class="slot-top">
              <span class="slot-role">${role}</span>
              ${m ? (hide ? `<span class="slot-rating hidden-rating">🔒</span>` : `<span class="slot-rating rt-${ratingTier(m.rating)}">${m.rating}</span>`) : ""}
            </div>
            <span class="slot-name">${m ? m.name : "—"}</span>
            ${m && !hide && m.bonuses.length ? `<span class="slot-bonuses">${bonusChipsHTML(m.bonuses)}</span>` : ""}
          </div>`;
      }).join("")}
    </div>`;
}

function buildReelStrip(strip, settledRoster) {
  // A column of random roster cards; if a roster is already drawn, show it parked.
  const items = [];
  for (let i = 0; i < 30; i++) items.push(pick(ROSTERS));
  if (settledRoster) items.push(settledRoster);
  strip.innerHTML = items
    .map(
      (r) => `
      <div class="reel-item">
        <span class="reel-flag">${r.flag}</span>
        <span class="reel-name">${r.name}</span>
      </div>`
    )
    .join("");
  // Park on the last item (the settled roster) instantly.
  const offset = (items.length - 1) * REEL_ITEM_H;
  strip.style.transition = "none";
  strip.style.transform = `translateY(-${offset}px)`;
}

async function drawTeam() {
  const drawBtn = $("#drawBtn");
  const doneBtn = $("#doneTransfer");
  if (drawBtn) drawBtn.disabled = true;
  if (doneBtn) doneBtn.disabled = true;

  if (game.mode === "transfer") {
    if (game.transfersLeft <= 0) return;
    game.transfersLeft -= 1;
  }

  // One unique roster per draw — never repeats within the session.
  const chosen = takeUniqueRoster(ROSTERS);
  game.currentRoster = chosen;
  game.drawnThisTurn = true;

  // Build a long random strip ending on the chosen roster, then animate.
  const strip = $("#reelStrip");
  const items = [];
  const count = 34;
  for (let i = 0; i < count; i++) items.push(pick(ROSTERS));
  items.push(chosen);
  strip.innerHTML = items
    .map(
      (r) => `
      <div class="reel-item">
        <span class="reel-flag">${r.flag}</span>
        <span class="reel-name">${r.name}</span>
      </div>`
    )
    .join("");
  strip.style.transition = "none";
  strip.style.transform = "translateY(0)";
  // force reflow so the next transform animates
  void strip.offsetHeight;
  const offset = (items.length - 1) * REEL_ITEM_H;
  strip.style.transition = "transform 2.7s cubic-bezier(.11,.66,.16,1)";
  strip.style.transform = `translateY(-${offset}px)`;

  $("#reelWrap").classList.add("spinning");
  playReelSound(2700);
  await sleep(2850);
  $("#reelWrap").classList.remove("spinning");

  // Update the transfer counter caption in place (no full re-render mid-animation).
  if (game.mode === "transfer") {
    const cap = $("#reelCaption");
    if (cap)
      cap.innerHTML = `You have <b>${game.transfersLeft}</b> draw${
        game.transfersLeft === 1 ? "" : "s"
      } left.`;
  }
  // The "Draw Team" button stays locked after a draw: the player must now resolve
  // the drawn roster by picking a member (or using the limited redraw). It unlocks
  // again only when the next role needs drawing.
  if (doneBtn) doneBtn.disabled = false;

  renderRosterPane(chosen);
}

function canFill(roster) {
  return roster.members.some((m) => isPickable(m));
}

function isPickable(member) {
  if (game.pickedNames.has(member.name)) return false;
  if (game.mode === "transfer") {
    // In transfers any role can be overwritten, but no duplicate names.
    return true;
  }
  return !game.crew[member.role];
}

function renderRosterPane(roster) {
  const pane = $("#rosterPane");
  if (!pane) return;
  const fillable = canFill(roster);
  const transfer = game.mode === "transfer";
  const hide = ratingsHidden();

  // Redraw availability (draft mode): a "free" redraw is always allowed when the
  // drawn roster can fill nothing (prevents a soft-lock); otherwise the player has
  // exactly ONE discretionary redraw for the entire initial draft.
  const redrawFree = !fillable;

  pane.innerHTML = `
    <div class="roster-card" style="--accent:${"#e7c66b"}">
      <div class="roster-card-head">
        <span class="roster-flag">${roster.flag}</span>
        <div>
          <h3>${roster.name}</h3>
          <p class="muted">${roster.missing.length ? `Missing: ${roster.missing.join(", ")}` : "Complete roster"}</p>
        </div>
      </div>
      <ul class="member-list">
        ${roster.members
          .map((m) => {
            const pickable = isPickable(m);
            const dupe = game.pickedNames.has(m.name);
            const taken = !transfer && game.crew[m.role] && !dupe;
            return `
            <li class="member ${pickable ? "pickable" : "locked"}" data-name="${encodeURIComponent(m.name)}">
              <div class="m-main">
                <span class="m-role">${m.role}</span>
                <span class="m-name">${m.name}</span>
                ${!hide && m.bonuses.length ? `<span class="m-bonuses">${bonusChipsHTML(m.bonuses)}</span>` : ""}
              </div>
              ${
                hide
                  ? `<span class="m-rating hidden-rating" title="Hidden in Expert Mode">🔒</span>`
                  : `<span class="m-rating rt-${ratingTier(m.rating)}" title="Rating">${m.rating}</span>`
              }
              <span class="m-status">${
                pickable ? (transfer ? "Swap in" : "Pick") : dupe ? "Already on crew" : taken ? "Role filled" : "—"
              }</span>
            </li>`;
          })
          .join("")}
      </ul>
      <div class="roster-foot">
        ${
          transfer
            ? `<span class="muted small">Pick one member to swap into your crew, or:</span>
               <button class="btn btn-ghost" id="skipDraw">Discard this draw ▸</button>`
            : redrawFree
            ? `<span class="redraw-status">Redraw Available: ${game.isEasyMode ? "∞" : `${game.redrawsLeft}/1`}</span>
               <button class="btn btn-ghost" id="redrawBtn">↻ No open role — draw again (free)</button>`
            : game.redrawsLeft > 0
            ? `<span class="redraw-status">${game.isEasyMode ? "Redraw Available: ∞" : "Redraw Available: 1/1"}</span>
               <button class="btn btn-ghost" id="redrawBtn">↻ ${game.isEasyMode ? "Draw again" : "Use your redraw"}</button>`
            : `<span class="redraw-status used">↻ Redraw Used</span>
               <span class="muted small">Make a pick.</span>`
        }
      </div>
    </div>
  `;

  pane.querySelectorAll(".member.pickable").forEach((li) => {
    li.addEventListener("click", () => {
      const name = decodeURIComponent(li.dataset.name);
      const member = roster.members.find((m) => m.name === name);
      if (member) pickMember(member, roster);
    });
  });

  const rb = pane.querySelector("#redrawBtn");
  if (rb)
    rb.addEventListener("click", () => {
      if (!redrawFree) game.redrawsLeft -= 1; // the one discretionary redraw is now spent
      drawTeam();
    });

  const skip = pane.querySelector("#skipDraw");
  if (skip)
    skip.addEventListener("click", () => {
      // The draw was already spent; just clear the pane and let the player draw again or finish.
      game.currentRoster = null;
      flashToast("Draw discarded — no swap made.");
      renderDraft();
    });
}

function pickMember(member, roster) {
  if (game.mode === "transfer") {
    const previous = game.crew[member.role];
    if (previous) game.pickedNames.delete(previous.name);
  }
  const entry = { ...member, from: roster.name };
  game.crew[member.role] = entry;
  game.pickedNames.add(member.name);
  game.currentRoster = null;
  saveGame();

  if (game.mode === "transfer") {
    flashToast(`✅ ${member.name} joins as ${member.role}`);
    // Draws are consumed at draw time; let the player keep using remaining draws.
    renderDraft();
    return;
  }

  flashToast(`✅ ${member.name} drafted as ${member.role}`);
  if (crewComplete()) {
    renderCrewComplete();
  } else {
    renderDraft();
  }
}

// ───────────────────────────────────────────────────────────────────────────
// SCREEN: crew complete
// ───────────────────────────────────────────────────────────────────────────
function renderCrewComplete() {
  root().innerHTML = "";
  const total = crewRating();
  const view = el(`
    <section class="screen crew-complete">
      <p class="kicker">Crew assembled</p>
      <h2 class="crew-title">Your crew is <span class="hl">COMPLETE</span></h2>
      <div class="crew-meta">
        <div class="meta-box"><span class="big">${fmt(total)}</span><span class="muted">total rating</span></div>
        <div class="meta-box"><span class="big">${(total / 15).toFixed(1)}</span><span class="muted">average</span></div>
        <div class="meta-box"><span class="big">${TOTAL_SEASONS}</span><span class="muted">seasons ahead</span></div>
      </div>
      <div class="crew-grid">
        ${ROLES.map((role) => {
          const m = game.crew[role];
          return `
            <div class="crew-card">
              <span class="cc-role">${role}</span>
              <span class="cc-name">${m.name}</span>
              <span class="cc-foot"><span class="cc-from">${m.from}</span><span class="cc-rating rt-${ratingTier(m.rating)}">${m.rating}</span></span>
              ${m.bonuses.length ? `<span class="cc-bonuses">${bonusChipsHTML(m.bonuses)}</span>` : ""}
            </div>`;
        }).join("")}
      </div>
      <button class="btn btn-primary btn-xl" id="toTournament">🎟️ Enter Season 1 ▸</button>
    </section>
  `);
  view.querySelector("#toTournament").addEventListener("click", () => {
    game.season = 1;
    startSeasonCircuit();
  });
  root().appendChild(view);
}

// ───────────────────────────────────────────────────────────────────────────
// SEASON CIRCUIT
// ───────────────────────────────────────────────────────────────────────────
function startSeasonCircuit() {
  game._festivalIndex = 0;
  game._seasonScore = 0;
  // Opponents are drawn fresh per festival; this set keeps a season's festivals
  // featuring different rosters whenever possible.
  game._seasonUsedRivalIds = new Set();
  // Track which crew member earns the most from standout moments (season MVP).
  game._seasonCharBoosts = {};
  enterFestival();
}

function beginSeason() {
  // Called after the transfer window closes.
  startSeasonCircuit();
}

function currentFestival() {
  return FESTIVALS[game._festivalIndex];
}

function bonusTagsHTML(tags) {
  if (!tags.length) return `<span class="muted small">no bonuses</span>`;
  return tags
    .map(
      (b) =>
        `<span class="bonus-tag bonus-${b.type}"><i class="bonus bonus-${b.type}"></i>${
          BONUS_LABELS[b.type]
        }${b.count > 1 ? ` ×${b.count}` : ""}</span>`
    )
    .join("");
}

// The line-up that will compete at a festival: player crew + that festival's rivals.
// Returns rows of { name, flag, avg, tags, isPlayer } sorted by average rating.
function festivalLineup() {
  const rows = [
    {
      name: "Your Crew",
      flag: "⭐",
      avg: teamAverage(game.crew),
      tags: bonusTags(game.crew),
      isPlayer: true,
    },
    ...game.festRivals.map((r) => {
      const team = rosterToTeam(r);
      return {
        name: r.name,
        flag: r.flag,
        avg: teamAverage(team),
        tags: bonusTags(team),
        isPlayer: false,
      };
    }),
  ];
  return rows.sort((a, b) => b.avg - a.avg);
}

// Entry point for each festival. Occasionally a producer's dilemma fires first
// (a separate layer from the in-festival random drama); otherwise we go straight
// to the festival intro.
function enterFestival() {
  saveGame();
  const decision = rollDecision();
  if (decision) {
    renderDecision(decision, () => renderFestivalIntro());
  } else {
    renderFestivalIntro();
  }
}

// Roughly 60% of festivals open with a dilemma, drawn without repeats. Returns
// null when none should fire (or the pool is exhausted for the run).
function rollDecision() {
  const pool = DECISIONS.filter((d) => !game.usedDecisions.has(d.id));
  if (!pool.length) return null;
  if (Math.random() > 0.6) return null;
  return pick(pool);
}

// ── SCREEN: interactive decision event ──────────────────────────────────────
function renderDecision(decision, onContinue) {
  game.usedDecisions.add(decision.id);
  root().innerHTML = "";
  const fest = currentFestival();
  const view = el(`
    <section class="screen decision-screen">
      <p class="kicker">Season ${game.season} · Producer's dilemma · ${fest.icon} ${fest.name} next</p>
      <div class="decision-card">
        <div class="decision-head">
          <span class="decision-icon">${decision.icon}</span>
          <h2 class="decision-title">${decision.title}</h2>
        </div>
        <p class="decision-desc">${decision.description}</p>
        ${festivalRepHUDHTML()}
        <div class="decision-choices" id="choiceList"></div>
        <p class="decision-foot muted small">Each choice helps some festivals and hurts others — there is no safe option.</p>
      </div>
    </section>
  `);

  const list = view.querySelector("#choiceList");
  decision.choices.forEach((choice, i) => {
    const btn = el(`
      <button class="decision-choice" data-i="${i}">
        <span class="choice-text">${choice.text}</span>
        <span class="choice-effects">${effectChipsHTML(choice.effect)}</span>
      </button>`);
    btn.addEventListener("click", () => resolveChoice(decision, choice, onContinue));
    list.appendChild(btn);
  });

  root().appendChild(view);
}

function resolveChoice(decision, choice, onContinue) {
  // Snapshot the effect display BEFORE applying, so the "target" token still
  // resolves to the festival the player is about to compete in.
  const deltaStr = effectChipsHTML(choice.effect);
  for (const [rawKey, v] of Object.entries(choice.effect)) {
    const key = resolveEffectKey(rawKey);
    if (key in game.festivalRep) game.festivalRep[key] += v;
  }

  const card = $(".decision-card");
  if (card) {
    card.innerHTML = `
      <div class="decision-head">
        <span class="decision-icon">${decision.icon}</span>
        <h2 class="decision-title">${decision.title}</h2>
      </div>
      <div class="decision-outcome">
        <p class="outcome-choice">“${choice.text}”</p>
        <p class="decision-flavour">${choice.flavour}</p>
        <div class="outcome-effects">${deltaStr}</div>
      </div>
      ${festivalRepHUDHTML()}
      <button class="btn btn-primary btn-lg" id="decisionContinue">Continue ▸</button>
    `;
    card.querySelector("#decisionContinue").addEventListener("click", onContinue);
  } else {
    onContinue();
  }
}

function renderFestivalIntro() {
  const fest = currentFestival();
  // Fresh, distinct opponents for this festival.
  game.festRivals = pickFestivalRivals(4);
  root().innerHTML = "";
  const lineup = festivalLineup();
  const view = el(`
    <section class="screen fest-intro" style="--accent:${fest.accent}">
      <p class="kicker">Season ${game.season} · Festival ${game._festivalIndex + 1} of ${FESTIVALS.length}</p>
      <div class="fest-badge">${fest.icon}</div>
      <h2 class="fest-name">${fest.name}</h2>
      <p class="fest-city">${fest.city}</p>
      <p class="fest-guidance">🎯 ${fest.guidance}</p>

      ${
        game.festivalRep[fest.key] !== 0 || hasAnyRep()
          ? `<div class="rep-panel">
               <span class="rep-label">Festival reputation${
                 game.festivalRep[fest.key] !== 0
                   ? ` · ${fest.name} <b class="${game.festivalRep[fest.key] > 0 ? "up" : "down"}">${
                       game.festivalRep[fest.key] > 0 ? "+" : ""
                     }${game.festivalRep[fest.key]}</b> here`
                   : ""
               }</span>
               ${festivalRepHUDHTML()}
             </div>`
          : ""
      }

      <div class="lineup">
        <h3 class="lineup-title">Tonight's competitors</h3>
        ${lineup
          .map(
            (t) => `
          <div class="lineup-row ${t.isPlayer ? "is-player" : ""}">
            <span class="lu-flag">${t.flag}</span>
            <span class="lu-name">${t.name}</span>
            <span class="lu-tags">${bonusTagsHTML(t.tags)}</span>
            <span class="lu-avg"><span class="muted small">avg</span> <b class="rt-${ratingTier(t.avg)}">${t.avg.toFixed(1)}</b></span>
          </div>`
          )
          .join("")}
      </div>

      <button class="btn btn-primary btn-xl" id="startFest">▶ Begin Screening</button>
    </section>
  `);
  view.querySelector("#startFest").addEventListener("click", () => runFestival(fest));
  root().appendChild(view);
}

function buildFestivalTeams(fest) {
  const teams = [];
  const playerBreak = scoreBreakdown(game.crew, fest, game.isEasyMode);
  // Fold THIS festival's accumulated reputation into the player's act targets,
  // split evenly across the three acts so good (or bad) decisions visibly pay
  // off exactly where they were earned.
  const repPerAct = (game.festivalRep[fest.key] || 0) / 3;
  teams.push({
    id: "player",
    name: "Your Crew",
    flag: "⭐",
    isPlayer: true,
    actTargets: playerBreak.acts.map((a) => Math.max(0, a + repPerAct)),
    members: Object.values(game.crew),
    score: 0,
    pending: 0,
  });

  // This festival's rivals — a fresh, distinct set, with per-night form.
  for (const r of game.festRivals) {
    const team = rosterToTeam(r);
    const b = scoreBreakdown(team, fest);
    const form = game.isEasyMode ? rand(0.92, 1.08) : rand(0.96, 1.15); // Easy: leggermente più morbido ma non facile
    teams.push({
      id: r.id,
      name: r.name,
      flag: r.flag,
      isPlayer: false,
      actTargets: b.acts.map((a) => a * form),
      members: r.members,
      score: 0,
      pending: 0,
    });
  }
  return teams;
}

async function runFestival(fest) {
  const teams = buildFestivalTeams(fest);
  let skipped = false;

  root().innerHTML = "";
  const view = el(`
    <section class="screen fest-live" style="--accent:${fest.accent}">
      <header class="live-head">
        <div class="live-title">
          <span class="fest-badge sm">${fest.icon}</span>
          <div>
            <p class="kicker">Season ${game.season} · LIVE</p>
            <h2>${fest.name}</h2>
          </div>
        </div>
        <div class="act-banner" id="actBanner">
          <span class="act-no">ACT 1</span>
          <span class="act-name">${ACTS[0].name}</span>
          <span class="act-blurb">${ACTS[0].blurb}</span>
        </div>
        <button class="btn btn-ghost" id="skipBtn">Skip ⏭</button>
      </header>

      <div class="leaderboard" id="board"></div>

      <div class="ticker" id="ticker">
        <span class="ticker-label">HIGHLIGHTS</span>
        <div class="ticker-feed" id="tickerFeed"></div>
      </div>
    </section>
  `);
  root().appendChild(view);

  const board = view.querySelector("#board");
  const rows = new Map();
  for (const t of teams) {
    const row = el(`
      <div class="lb-row ${t.isPlayer ? "is-player" : ""}">
        <span class="lb-rank">–</span>
        <span class="lb-flag">${t.flag}</span>
        <span class="lb-name">${t.name}</span>
        <div class="lb-bar"><div class="lb-fill"></div></div>
        <span class="lb-score">0</span>
      </div>`);
    board.appendChild(row);
    rows.set(t.id, row);
  }

  view.querySelector("#skipBtn").addEventListener("click", () => {
    skipped = true;
  });

  function paint() {
    const maxScore = Math.max(1, ...teams.map((t) => t.score));
    const ranked = [...teams].sort((a, b) => b.score - a.score);
    ranked.forEach((t, i) => {
      const row = rows.get(t.id);
      row.style.order = i;
      row.querySelector(".lb-rank").textContent = i + 1;
      row.querySelector(".lb-score").textContent = fmt(t.score);
      row.querySelector(".lb-fill").style.width = `${(t.score / maxScore) * 100}%`;
      row.classList.toggle("leader", i === 0);
    });
  }

  function pushHighlight(event, teamName, delta, who) {
    const feed = view.querySelector("#tickerFeed");
    const item = el(
      `<div class="hl-item ${event.tone}"><span class="hl-icon">${event.icon}</span><span>${event.line(
        teamName,
        who
      )} <b>(${delta > 0 ? "+" : ""}${Math.round(delta)})</b></span></div>`
    );
    feed.prepend(item);
    while (feed.children.length > 5) feed.lastChild.remove();
    const board = rows.get(teams.find((t) => t.name === teamName)?.id);
    if (board) {
      board.classList.add("event-flash", event.tone);
      setTimeout(() => board.classList.remove("event-flash", event.tone), 700);
    }
  }

  const highlights = [];

  // Run the three acts.
  for (let a = 0; a < ACTS.length; a++) {
    const actBanner = view.querySelector("#actBanner");
    actBanner.querySelector(".act-no").textContent = `ACT ${a + 1}`;
    actBanner.querySelector(".act-name").textContent = ACTS[a].name;
    actBanner.querySelector(".act-blurb").textContent = ACTS[a].blurb;
    actBanner.classList.remove("flash");
    void actBanner.offsetWidth;
    actBanner.classList.add("flash");

    const starts = new Map(teams.map((t) => [t.id, t.score]));
    teams.forEach((t) => (t.pending = 0));

    const duration = 3000;
    const start = performance.now();
    let nextEventAt = start + rand(500, 1100);

    await new Promise((resolve) => {
      function frame(now) {
        if (skipped) {
          teams.forEach((t) => (t.score = starts.get(t.id) + t.actTargets[a] + t.pending));
          paint();
          return resolve();
        }
        const t = clamp((now - start) / duration, 0, 1);
        const e = easeOutCubic(t);
        teams.forEach((tm) => {
          tm.score = starts.get(tm.id) + tm.actTargets[a] * e + tm.pending;
        });

        if (now >= nextEventAt && t < 0.92) {
          const ev = rollEvent(Math.random);
          const target = pick(teams); // uniform across ALL teams — player included
          const delta = eventDelta(ev, Math.random);
          // Character-scoped events name a random member of the target team.
          let who = null;
          if (ev.scope === "char" && target.members && target.members.length) {
            who = pick(target.members).name;
          }
          target.pending = Math.max(target.pending + delta, -starts.get(target.id) * 0.4);
          // Credit positive moments earned by the player's own crew toward the season MVP.
          if (target.isPlayer && who && delta > 0) {
            game._seasonCharBoosts[who] = (game._seasonCharBoosts[who] || 0) + delta;
          }
          pushHighlight(ev, target.name, delta, who);
          highlights.push({ ...ev, team: target.name, delta, who });
          nextEventAt = now + rand(650, 1300);
        }

        paint();
        if (t >= 1) return resolve();
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });

    // bake act result
    teams.forEach((t) => (t.score = starts.get(t.id) + t.actTargets[a] + t.pending));
    paint();
    if (!skipped) await sleep(550);
  }

  paint();
  await sleep(500);
  finishFestival(fest, teams, highlights);
}

function finishFestival(fest, teams, highlights) {
  const ranked = [...teams].sort((a, b) => b.score - a.score);
  const playerRank = ranked.findIndex((t) => t.isPlayer) + 1;
  const playerScore = teams.find((t) => t.isPlayer).score;
  const won = playerRank === 1;

  // Anti-cheat: each festival can only be scored once per season.
  // If the player reloads and replays a festival, the score is ignored.
  const scoreKey = `S${game.season}-${fest.key}`;
  const alreadyScored = game._scoredKeys.has(scoreKey);
  if (!alreadyScored) {
    game._scoredKeys.add(scoreKey);
    game._seasonScore += playerScore;
    game.grandTotal += playerScore;
    game.results.push({
      season: game.season,
      festival: fest.name,
      icon: fest.icon,
      rank: playerRank,
      score: playerScore,
      won,
    });
  }

  // Conquering a festival is permanent for the run — the heart of the Grand Slam.
  const newlyConquered = won && !game.conquered.has(fest.key);
  if (won) {
    game.conquered.add(fest.key);
    if (!alreadyScored) setTimeout(() => launchConfetti(newlyConquered ? "slam" : "festival"), 400);
  }
  saveGame();
  renderRoadmap();

  root().innerHTML = "";
  const medal = ["🥇", "🥈", "🥉", "4th", "5th"][playerRank - 1];
  const podium = playerRank <= 3;
  const verdictTitle = won
    ? "You WIN the Festival!"
    : podium
    ? "On the podium!"
    : "Out of the podium";
  const view = el(`
    <section class="screen fest-result" style="--accent:${fest.accent}">
      <p class="kicker">Season ${game.season} · ${fest.name} — Final ranking</p>
      <div class="result-verdict ${won ? "win" : podium ? "good" : "bad"}">
        <span class="verdict-medal">${medal}</span>
        <div>
          <h2>${verdictTitle}</h2>
          ${
            won
              ? `<p class="verdict-sub">${
                  newlyConquered ? "🏆 Festival CONQUERED — added to your Grand Slam" : "🏆 Official Festival Winner"
                }</p>`
              : `<p class="verdict-sub muted">${fest.name} not conquered — another chance next season.</p>`
          }
          <p class="muted">You placed <b>#${playerRank}</b> of ${teams.length}.</p>
        </div>
      </div>

      <ol class="final-board">
        ${ranked
          .map(
            (t, i) => `
          <li class="fb-row ${t.isPlayer ? "is-player" : ""}">
            <span class="fb-rank">${i === 0 ? "🏆" : i + 1}</span>
            <span class="fb-flag">${t.flag}</span>
            <span class="fb-name">${t.name}</span>
            <span class="fb-score">${fmt(t.score)}</span>
          </li>`
          )
          .join("")}
      </ol>

      ${
        highlights.length
          ? `<div class="result-highlights">
              <h3>Highlight reel</h3>
              ${highlights
                .slice(-5)
                .reverse()
                .map(
                  (h) =>
                    `<div class="hl-item ${h.tone}"><span class="hl-icon">${h.icon}</span><span>${h.line(
                      h.team,
                      h.who
                    )} <b>(${h.delta > 0 ? "+" : ""}${Math.round(h.delta)})</b></span></div>`
                )
                .join("")}
            </div>`
          : ""
      }

      <button class="btn btn-primary btn-xl" id="next"></button>
    </section>
  `);

  const nextBtn = view.querySelector("#next");
  const isLastFest = game._festivalIndex >= FESTIVALS.length - 1;
  nextBtn.textContent = isLastFest ? "End of season ▸" : `Next: ${FESTIVALS[game._festivalIndex + 1].name} ▸`;
  nextBtn.addEventListener("click", () => {
    if (isLastFest) {
      renderSeasonEnd();
    } else {
      game._festivalIndex += 1;
      enterFestival();
    }
  });
  root().appendChild(view);
}

// ───────────────────────────────────────────────────────────────────────────
// SCREEN: season end
// ───────────────────────────────────────────────────────────────────────────
// The season's standout crew member: whoever earned the most from positive
// in-festival moments; failing any drama, the highest-rated member.
function seasonMVP() {
  const boosts = game._seasonCharBoosts || {};
  const names = Object.keys(boosts);
  if (names.length) {
    const top = names.sort((a, b) => boosts[b] - boosts[a])[0];
    return { name: top, note: `+${Math.round(boosts[top])} pts from standout moments` };
  }
  const members = Object.values(game.crew);
  if (!members.length) return null;
  const top = members.slice().sort((a, b) => b.rating - a.rating)[0];
  return { name: top.name, note: `Top-rated crew member · ${top.rating}` };
}

// Player vs persistent rivals over the whole season, ranked by total points.
function renderSeasonEnd() {
  game.seasonScores[game.season - 1] = game._seasonScore;
  const isFinalSeason = game.season >= TOTAL_SEASONS;
  root().innerHTML = "";
  const seasonResults = game.results.filter((r) => r.season === game.season);
  const wins = seasonResults.filter((r) => r.won).length;
  const mvp = seasonMVP();
  const remaining = FESTIVALS.filter((f) => !game.conquered.has(f.key));
  const conqueredCount = FESTIVALS.length - remaining.length;

  const view = el(`
    <section class="screen season-end">
      <p class="kicker">Season ${game.season} complete</p>
      <h2>You have conquered <span class="hl">${conqueredCount}</span> of ${FESTIVALS.length} majors</h2>

      <div class="season-summary">
        <div class="meta-box"><span class="big">${wins} 🏆</span><span class="muted">wins this season</span></div>
        <div class="meta-box"><span class="big">${conqueredCount}/${FESTIVALS.length}</span><span class="muted">grand slam progress</span></div>
        <div class="meta-box"><span class="big">${remaining.length}</span><span class="muted">still to conquer</span></div>
      </div>

      <h3 class="recap-title">Grand Slam objectives</h3>
      <div class="slam-grid">
        ${FESTIVALS.map((f) => {
          const done = game.conquered.has(f.key);
          return `
          <div class="slam-obj ${done ? "won" : "todo"}">
            <span class="slam-mark">${done ? "🏆" : "❌"}</span>
            <span class="slam-icon">${f.icon}</span>
            <span class="slam-name">${f.name}</span>
          </div>`;
        }).join("")}
      </div>

      <h3 class="recap-title">This season's festivals</h3>
      <div class="season-recap">
        ${seasonResults
          .map(
            (r) => `
          <div class="recap-row ${r.won ? "won" : "lost"}">
            <span class="recap-icon">${r.icon}</span>
            <span class="recap-fest">${r.festival}</span>
            <span class="recap-rank">${r.won ? "🏆 Conquered" : `#${r.rank}`}</span>
            <span class="recap-score">${fmt(r.score)}</span>
          </div>`
          )
          .join("")}
      </div>

      ${
        mvp
          ? `<div class="mvp-card">
               <span class="mvp-label">⭐ Best-performing character</span>
               <span class="mvp-name">${mvp.name}</span>
               <span class="muted small">${mvp.note}</span>
             </div>`
          : ""
      }

      ${
        isFinalSeason
          ? `<button class="btn btn-primary btn-xl" id="toFinal">See Grand Slam verdict ▸</button>`
          : `<div class="transfer-pitch">
               <p>🎟️ You receive <b>3 transfer draws</b> for Season ${game.season + 1}.
                Use them to replace up to three crew members — or keep your crew as is.</p>
               <div class="season-actions">
                 <button class="btn btn-primary btn-lg" id="openTransfer">Open transfer window</button>
                 <button class="btn btn-ghost btn-lg" id="skipTransfer">Keep crew &amp; continue ▸</button>
               </div>
             </div>`
      }
    </section>
  `);

  if (isFinalSeason) {
    view.querySelector("#toFinal").addEventListener("click", () => renderGameOver());
  } else {
    view.querySelector("#openTransfer").addEventListener("click", () => {
      game.season += 1;
      game.transfersLeft = 3;
      game.currentRoster = null;
      game.mode = "transfer";
      saveGame();
      renderDraft();
    });
    view.querySelector("#skipTransfer").addEventListener("click", () => {
      game.season += 1;
      saveGame();
      startSeasonCircuit();
    });
  }
  root().appendChild(view);
}

// ───────────────────────────────────────────────────────────────────────────
// SCREEN: game over / final standings
// ───────────────────────────────────────────────────────────────────────────
function renderGameOver() {
  deleteSave(); // anti-cheat: cancella il save appena si arriva alla fine
  root().innerHTML = "";
  const conquered = FESTIVALS.filter((f) => game.conquered.has(f.key));
  const missing = FESTIVALS.filter((f) => !game.conquered.has(f.key));
  const grandSlam = missing.length === 0;

  // Grand Slam bonus: +1000 punti sul punteggio finale
  const finalScore = grandSlam ? game.grandTotal + 1000 : game.grandTotal;

  // Tally every festival win across all seasons, grouped and counted, sorted
  // by number of wins descending (e.g. "Venice × 3").
  const winTally = {};
  for (const r of game.results) {
    if (!r.won) continue;
    if (!winTally[r.festival]) winTally[r.festival] = { count: 0, icon: r.icon };
    winTally[r.festival].count += 1;
  }
  const tallyRows = Object.entries(winTally).sort((a, b) => b[1].count - a[1].count);

  const view = el(`
    <section class="screen game-over ${grandSlam ? "slam-win" : "slam-fail"}">
      <div class="intro-glow"></div>
      <p class="kicker">Career complete · ${TOTAL_SEASONS} seasons</p>

      ${
        grandSlam
          ? `<h1 class="slam-verdict win">🏆 CINEMA GRAND SLAM ACHIEVED</h1>
             <p class="slam-tagline">"You became the greatest producer in cinema history."</p>`
          : `<h1 class="slam-verdict fail">❌ GRAND SLAM FAILED</h1>
             <p class="slam-tagline">You conquered ${conquered.length} of ${FESTIVALS.length} majors — but the Grand Slam demands them all.</p>`
      }

      <div class="slam-grid final">
        ${FESTIVALS.map((f) => {
          const done = game.conquered.has(f.key);
          return `
          <div class="slam-obj ${done ? "won" : "todo"}">
            <span class="slam-mark">${done ? "🏆" : "❌"}</span>
            <span class="slam-icon">${f.icon}</span>
            <span class="slam-name">${f.name}</span>
          </div>`;
        }).join("")}
      </div>

      ${
        missing.length
          ? `<div class="slam-missing">
               <h3 class="recap-title">Festivals not conquered</h3>
               <p>${missing.map((f) => `${f.icon} ${f.name}`).join(" · ")}</p>
             </div>`
          : ""
      }

      <p class="muted">${game.results.filter((r) => r.won).length} festival wins across ${game.results.length} screenings over ${TOTAL_SEASONS} seasons.</p>

      <!-- ── DETAILED STATS ── -->
      ${(() => {
        const bestResult = game.results.reduce((b, r) => (!b || r.score > b.score) ? r : b, null);
        const worstResult = game.results.reduce((b, r) => (!b || r.score < b.score) ? r : b, null);
        const crewMembers = Object.entries(game.crew).map(([role, m]) => ({ role, ...m }));
        const bestMember = crewMembers.sort((a, b) => b.rating - a.rating)[0];
        const avgScore = game.results.length ? game.grandTotal / game.results.length : 0;
        const winRate = game.results.length ? Math.round((game.results.filter(r => r.won).length / game.results.length) * 100) : 0;
        const bestSeasonIdx = game.seasonScores.reduce((bi, s, i) => s > (game.seasonScores[bi] || 0) ? i : bi, 0);
        const neverWon = FESTIVALS.filter(f => !Object.keys(winTally).includes(f.name));
        return `
        <div class="detailed-stats">
          <h3 class="recap-title">📊 Career Statistics</h3>
          <div class="stats-grid">
            <div class="stat-card">
              <span class="stat-icon">🎯</span>
              <span class="stat-label">Total score</span>
              <span class="stat-value">${fmt(finalScore)}</span>
              ${grandSlam ? `<span class="stat-sub">incl. Grand Slam +1000 bonus</span>` : ""}
            </div>
            <div class="stat-card">
              <span class="stat-icon">📈</span>
              <span class="stat-label">Avg per festival</span>
              <span class="stat-value">${fmt(avgScore)}</span>
            </div>
            <div class="stat-card">
              <span class="stat-icon">🏆</span>
              <span class="stat-label">Win rate</span>
              <span class="stat-value">${winRate}%</span>
            </div>
            <div class="stat-card">
              <span class="stat-icon">🎬</span>
              <span class="stat-label">Festivals played</span>
              <span class="stat-value">${game.results.length}</span>
            </div>
            ${bestResult ? `<div class="stat-card highlight">
              <span class="stat-icon">⭐</span>
              <span class="stat-label">Best performance</span>
              <span class="stat-value">${bestResult.icon} ${bestResult.festival}</span>
              <span class="stat-sub">${fmt(bestResult.score)} pts · S${bestResult.season}</span>
            </div>` : ""}
            ${worstResult ? `<div class="stat-card">
              <span class="stat-icon">📉</span>
              <span class="stat-label">Toughest festival</span>
              <span class="stat-value">${worstResult.icon} ${worstResult.festival}</span>
              <span class="stat-sub">${fmt(worstResult.score)} pts · S${worstResult.season}</span>
            </div>` : ""}
            ${bestMember ? `<div class="stat-card highlight">
              <span class="stat-icon">🌟</span>
              <span class="stat-label">Strongest role</span>
              <span class="stat-value">${bestMember.name}</span>
              <span class="stat-sub">${bestMember.role} · Rating ${bestMember.rating}</span>
            </div>` : ""}
            ${game.seasonScores.length ? `<div class="stat-card">
              <span class="stat-icon">📅</span>
              <span class="stat-label">Best season</span>
              <span class="stat-value">Season ${bestSeasonIdx + 1}</span>
              <span class="stat-sub">${fmt(game.seasonScores[bestSeasonIdx])} pts</span>
            </div>` : ""}
            ${neverWon.length && neverWon.length < FESTIVALS.length ? `<div class="stat-card bad">
              <span class="stat-icon">💔</span>
              <span class="stat-label">Never won</span>
              <span class="stat-value">${neverWon.map(f => f.icon + " " + f.name).join(", ")}</span>
            </div>` : ""}
          </div>
          ${game.seasonScores.length ? `
          <div class="season-scores-bar">
            <h4>Points per season</h4>
            <div class="ssb-bars">
              ${game.seasonScores.map((s, i) => {
                const max = Math.max(...game.seasonScores);
                const pct = max ? Math.round((s / max) * 100) : 0;
                return `<div class="ssb-item">
                  <span class="ssb-label">S${i+1}</span>
                  <div class="ssb-track"><div class="ssb-fill" style="width:${pct}%"></div></div>
                  <span class="ssb-val">${fmt(s)}</span>
                </div>`;
              }).join("")}
            </div>
          </div>` : ""}
        </div>`;
      })()}

      ${
        tallyRows.length
          ? `<div class="recap-wins">
               <h3 class="recap-title">Festivals won</h3>
               <div class="wins-grid">
                 ${tallyRows
                   .map(
                     ([name, info]) => `
                   <div class="wins-row">
                     <span class="wins-icon">${info.icon}</span>
                     <span class="wins-name">${name}</span>
                     <span class="wins-count">× ${info.count}</span>
                   </div>`
                   )
                   .join("")}
               </div>
             </div>`
          : ""
      }

      <div class="recap-crew">
        <h3 class="recap-title">Your final crew</h3>
        <div class="crew-grid">
          ${ROLES.map((role) => {
            const m = game.crew[role];
            if (!m) return "";
            return `
              <div class="crew-card">
                <span class="cc-role">${role}</span>
                <span class="cc-name">${m.name}</span>
                <span class="cc-foot"><span class="cc-from">${m.from || ""}</span><span class="cc-rating rt-${ratingTier(m.rating)}">${m.rating}</span></span>
                ${m.bonuses.length ? `<span class="cc-bonuses">${bonusChipsHTML(m.bonuses)}</span>` : ""}
              </div>`;
          }).join("")}
        </div>
      </div>

      <div class="share-box">
        <h3 class="recap-title">Share your career</h3>
        <div class="share-actions">
          <button class="btn btn-primary" id="shareTwitter">𝕏 Share on X</button>
          <button class="btn" id="shareFacebook">f Share on Facebook</button>
          <button class="btn btn-ghost" id="shareCopy">⧉ Copy card</button>
        </div>
      </div>

      ${grandSlam ? `<button class="btn btn-goat btn-xl" id="faceGoat">🐐 Face the GOAT</button>` : ""}
      <div class="leaderboard-submit" id="lbSubmit">
        <h3 class="recap-title">🌍 Global Leaderboard</h3>
        <p class="muted">Submit your score to the global top 15.</p>
        <div class="lb-submit-row">
          <input class="player-name-input" id="submitName" type="text" maxlength="30"
            placeholder="Your name..." value="${game.playerName !== "Anonymous" ? game.playerName : ""}" />
          <button class="btn btn-primary" id="submitScoreBtn">Submit score</button>
        </div>
        <p class="lb-submit-note muted small">Score: <b>${fmt(finalScore)}</b>${grandSlam ? ` <span class="slam-bonus">(${fmt(game.grandTotal)} + 1000 Grand Slam bonus 🏆)</span>` : ""} · Festivals won: <b>${game.results.filter(r=>r.won).length}</b>${grandSlam ? " · 🏆 Grand Slam" : ""}</p>
        <div id="lbResult"></div>
        <button class="btn btn-ghost" id="viewLeaderboard">View global top 15 →</button>
      </div>
      <button class="btn btn-primary btn-xl" id="restart">↺ Play again</button>
    </section>
  `);
  wireShareButtons(view, tallyRows, grandSlam);
  view.querySelector("#restart").addEventListener("click", () => { deleteSave(); deleteSubmitKeys(); location.reload(); });
  if (grandSlam) {
    view.querySelector("#faceGoat").addEventListener("click", renderGoatIntro);
    setTimeout(() => launchConfetti("slam"), 500);
  }

  // Leaderboard submit
  const SUBMIT_KEY = "cgs_submitted_" + game.grandTotal;
  const alreadySubmitted = !!localStorage.getItem(SUBMIT_KEY);
  let submitAttempts = 0;
  const submitBtn = view.querySelector("#submitScoreBtn");
  const submitName = view.querySelector("#submitName");
  if (alreadySubmitted) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Already submitted ✓";
    submitName.disabled = true;
  }
  view.querySelector("#submitScoreBtn").addEventListener("click", async () => {
    if (submitAttempts >= 3 || alreadySubmitted) return;
    const name = submitName.value.trim() || "Anonymous";
    const btn = view.querySelector("#submitScoreBtn");
    const result = view.querySelector("#lbResult");
    btn.disabled = true;
    btn.textContent = "Submitting…";
    submitAttempts++;
    const ok = await submitScore(name, finalScore, game.results.filter(r=>r.won).length, grandSlam);
    if (ok) {
      localStorage.setItem(SUBMIT_KEY, "1");
      result.innerHTML = `<p class="lb-ok">✅ Score submitted! Good luck in the rankings.</p>`;
      btn.textContent = "Submitted ✓";
      btn.disabled = true;
      submitName.disabled = true;
    } else {
      result.innerHTML = `<p class="lb-err">❌ Submission failed — check your connection.${submitAttempts >= 3 ? " No more attempts." : ""}</p>`;
      if (submitAttempts < 3) {
        btn.disabled = false;
        btn.textContent = `Try again (${3 - submitAttempts} left)`;
      } else {
        btn.textContent = "No more attempts";
      }
    }
  });
  view.querySelector("#viewLeaderboard").addEventListener("click", () => renderLeaderboardScreen());

  root().appendChild(view);
}

// ── GLOBAL LEADERBOARD SCREEN ──────────────────────────────────────────────
async function renderLeaderboardScreen(currentTab = "dummies") {
  root().innerHTML = "";
  const view = el(`
    <section class="screen leaderboard-screen">
      <div class="intro-glow"></div>
      <p class="kicker">Cinema Grand Slam</p>
      <h1 class="goat-title">🌍 Global Top 15</h1>
      <p class="goat-sub">The greatest producers in cinema history.</p>
      
      <div class="lb-tabs" style="display: flex; gap: 10px; justify-content: center; margin-bottom: 20px;">
        <button class="btn ${currentTab === "dummies" ? "btn-primary" : "btn-ghost"}" id="tab-dummies">🟢 For Dummies</button>
        <button class="btn ${currentTab === "normal" ? "btn-primary" : "btn-ghost"}" id="tab-normal">🟡 Expert</button>
        <button class="btn ${currentTab === "master" ? "btn-primary" : "btn-ghost"}" id="tab-master">🔴 Master</button>
      </div>

      <div id="lbTable" class="lb-global-wrap">
        <p class="muted">Loading ${currentTab.toUpperCase()} leaderboard…</p>
      </div>
      <button class="btn btn-ghost" id="backFromLb">← Back</button>
    </section>
  `);

  view.querySelector("#tab-dummies").addEventListener("click", () => renderLeaderboardScreen("dummies"));
  view.querySelector("#tab-normal").addEventListener("click", () => renderLeaderboardScreen("normal"));
  view.querySelector("#tab-master").addEventListener("click", () => renderLeaderboardScreen("master"));

  view.querySelector("#backFromLb").addEventListener("click", () => {
    if (game.started) {
      renderGameOver();
    } else {
      renderIntro();
    }
  });
  root().appendChild(view);

  const rows = await fetchLeaderboard(currentTab);
  const table = view.querySelector("#lbTable");

  if (!rows.length) {
    table.innerHTML = `<p class="muted">No scores yet in ${currentTab.toUpperCase()} — be the first!</p>`;
    return;
  }

  const medals = ["🥇","🥈","🥉"];
  table.innerHTML = `
    <table class="lb-global-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th>Score</th>
          <th>Wins</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => `
          <tr class="lb-global-row ${i < 3 ? "top3" : ""} ${r.grand_slam ? "grand-slam-row" : ""}">
            <td class="lb-rank-cell">${medals[i] || i + 1}</td>
            <td class="lb-name-cell">${r.player_name}</td>
            <td class="lb-score-cell">${fmt(r.score)}</td>
            <td class="lb-wins-cell">${r.festivals_won} 🏆</td>
            <td class="lb-slam-cell">${r.grand_slam ? "🎬 Grand Slam" : ""}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

// ── GOAT CHALLENGE ─────────────────────────────────────────────────────────

function renderGoatIntro() {
  root().innerHTML = "";

  // Build roster comparison rows
  const goatMembers = Object.entries(GOAT_TEAM);
  const playerAvg = Math.round(teamAverage(game.crew));
  const goatAvg = Math.round(goatMembers.reduce((s, [, m]) => s + m.rating, 0) / goatMembers.length);

  const comparisonRows = ROLES.map((role) => {
    const pm = game.crew[role];
    const gm = GOAT_TEAM[role];
    const pRating = pm ? pm.rating : 0;
    const gRating = gm ? gm.rating : 0;
    const playerWins = pRating >= gRating;
    return `
      <tr class="roster-cmp-row">
        <td class="cmp-role">${role}</td>
        <td class="cmp-player ${playerWins ? "cmp-winner" : ""}">
          ${pm ? `<span class="cmp-name">${pm.name}</span><span class="cmp-rating">${pm.rating}</span>` : `<span class="cmp-missing">—</span>`}
        </td>
        <td class="cmp-vs">vs</td>
        <td class="cmp-goat ${!playerWins ? "cmp-winner" : ""}">
          ${gm ? `<span class="cmp-rating">${gm.rating}</span><span class="cmp-name">${gm.name}</span>` : `<span class="cmp-missing">—</span>`}
        </td>
      </tr>`;
  }).join("");

  const view = el(`
    <section class="screen goat-intro">
      <div class="intro-glow"></div>
      <p class="kicker">Bonus Challenge</p>
      <h1 class="goat-title">🐐 THE GOAT CHALLENGE</h1>
      <p class="goat-sub">You conquered every festival. But one final opponent stands between you and immortality.</p>

      <div class="roster-comparison">
        <div class="cmp-header">
          <div class="cmp-header-player">🎬 Your Crew <span class="cmp-avg ${playerAvg >= 90 ? "cmp-avg-good" : ""}">avg ${playerAvg}</span></div>
          <div class="cmp-header-goat">🐐 Cinema GOAT <span class="cmp-avg">avg ${goatAvg}</span></div>
        </div>
        <table class="cmp-table">
          <tbody>${comparisonRows}</tbody>
        </table>
      </div>

      <div class="goat-format">
        <h3>Format: Best of 3</h3>
        <p>Three rounds at the GOAT Awards — the jury rewards every craft equally. Win 2 rounds to claim the title of Greatest Producer in Cinema History.</p>
        ${playerAvg >= 90 ? `<p class="cmp-hint good">✅ Your crew average is ${playerAvg} — you have what it takes.</p>` : `<p class="cmp-hint warn">⚠️ Your crew average is ${playerAvg} — aim for 90+ to have a real chance.</p>`}
      </div>
      <button class="btn btn-goat btn-xl" id="startGoat">⚔️ Begin the Challenge</button>
      <button class="btn btn-ghost" id="skipGoat">← Back to career summary</button>
    </section>
  `);
  view.querySelector("#startGoat").addEventListener("click", () => runGoatChallenge());
  view.querySelector("#skipGoat").addEventListener("click", renderGameOver);
  root().appendChild(view);
}

async function runGoatChallenge() {
  // Best of 3 — first to 2 wins takes the title.
  let playerWins = 0;
  let goatWins = 0;

  for (let round = 1; round <= 3; round++) {
    if (playerWins === 2 || goatWins === 2) break;
    const result = await runGoatRound(round, playerWins, goatWins);
    if (result === "player") playerWins++;
    else goatWins++;
  }

  renderGoatResult(playerWins, goatWins);
}

async function runGoatRound(round, playerWins, goatWins) {
  const fest = GOAT_FESTIVAL;
  const playerTeam = game.crew;
  const pb = scoreBreakdown(playerTeam, fest);
  const gb = scoreBreakdown(GOAT_TEAM, fest);

  // Player gets a small random form boost; GOAT is always at peak.
  // GOAT form lowered to 0.95-1.05 as requested
  const playerAvg = teamAverage(game.crew);
  let playerForm = rand(0.97, 1.06);
  if (playerAvg >= 90) {
    // Elite crew (90+ avg) gets meaningful advantage vs GOAT
    playerForm = rand(1.02, 1.12);
  }
  const goatForm = rand(0.95, 1.05);

  const teams = [
    {
      id: "player",
      name: "Your Crew",
      flag: "🎬",
      isPlayer: true,
      actTargets: pb.acts.map((a) => a * playerForm),
      members: Object.values(playerTeam).filter(Boolean),
      score: 0,
      pending: 0,
    },
    {
      id: "goat",
      name: "Cinema GOAT",
      flag: "🐐",
      isPlayer: false,
      actTargets: gb.acts.map((a) => a * goatForm),
      members: Object.values(GOAT_TEAM).filter(Boolean),
      score: 0,
      pending: 0,
    },
  ];

  return new Promise((resolve) => {
    root().innerHTML = "";
    const view = el(`
      <section class="screen live-sim goat-round" style="--accent:${fest.accent}">
        <div class="sim-header">
          <p class="kicker">GOAT Challenge · Round ${round} of 3 · Score: You ${playerWins} – ${goatWins} GOAT</p>
          <h2 class="sim-title">${fest.icon} ${fest.name}</h2>
          <p class="sim-sub">${fest.guidance}</p>
        </div>
        <div id="actBanner" class="act-banner">
          <span class="act-no">ACT 1</span>
          <span class="act-name">Film Introduction</span>
          <span class="act-blurb">Directing & cast introduction</span>
        </div>
        <div id="leaderboard" class="leaderboard goat-board">
          ${teams.map((t) => `
            <div class="lb-row ${t.isPlayer ? "is-player" : "is-goat"}" data-id="${t.id}">
              <span class="lb-flag">${t.flag}</span>
              <span class="lb-name">${t.name}</span>
              <span class="lb-score">0</span>
              <div class="lb-bar"><div class="lb-fill" style="width:0%"></div></div>
            </div>`).join("")}
        </div>
        <div id="tickerFeed" class="ticker-feed"></div>
        <button class="btn btn-ghost sim-skip" id="skipBtn">⏭ Skip</button>
      </section>
    `);

    let skipped = false;
    view.querySelector("#skipBtn").addEventListener("click", () => { skipped = true; });
    root().appendChild(view);

    const rows = new Map(teams.map((t) => [t.id, view.querySelector(`[data-id="${t.id}"]`)]));

    function fmt(n) { return Math.round(n).toLocaleString(); }
    function paint() {
      const maxScore = Math.max(...teams.map((t) => t.score), 1);
      teams.forEach((t) => {
        const row = rows.get(t.id);
        row.querySelector(".lb-score").textContent = fmt(t.score);
        row.querySelector(".lb-fill").style.width = `${(t.score / maxScore) * 100}%`;
      });
    }

    function pushHighlight(event, teamName, delta, who) {
      const feed = view.querySelector("#tickerFeed");
      const item = el(`<div class="hl-item ${event.tone}"><span class="hl-icon">${event.icon}</span><span>${event.line(teamName, who)} <b>(${delta > 0 ? "+" : ""}${Math.round(delta)})</b></span></div>`);
      feed.prepend(item);
      while (feed.children.length > 4) feed.lastChild.remove();
    }

    (async () => {
      for (let a = 0; a < ACTS.length; a++) {
        const actBanner = view.querySelector("#actBanner");
        actBanner.querySelector(".act-no").textContent = `ACT ${a + 1}`;
        actBanner.querySelector(".act-name").textContent = ACTS[a].name;
        actBanner.querySelector(".act-blurb").textContent = ACTS[a].blurb;
        actBanner.classList.remove("flash");
        void actBanner.offsetWidth;
        actBanner.classList.add("flash");

        const starts = new Map(teams.map((t) => [t.id, t.score]));
        teams.forEach((t) => (t.pending = 0));

        const duration = 3000;
        const start = performance.now();
        let nextEventAt = start + rand(500, 1100);

        await new Promise((res) => {
          function frame(now) {
            if (skipped) {
              teams.forEach((t) => (t.score = starts.get(t.id) + t.actTargets[a] + t.pending));
              paint();
              return res();
            }
            const tt = clamp((now - start) / duration, 0, 1);
            const e = easeOutCubic(tt);
            teams.forEach((tm) => {
              tm.score = starts.get(tm.id) + tm.actTargets[a] * e + tm.pending;
            });
            if (now >= nextEventAt && tt < 0.92) {
              const ev = rollEvent(Math.random);
              const target = pick(teams);
              const delta = eventDelta(ev, Math.random);
              let who = null;
              if (ev.scope === "char" && target.members && target.members.length) {
                who = pick(target.members).name;
              }
              target.pending = Math.max(target.pending + delta, -starts.get(target.id) * 0.4);
              pushHighlight(ev, target.name, delta, who);
              nextEventAt = now + rand(650, 1300);
            }
            paint();
            if (tt >= 1) return res();
            requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        });

        teams.forEach((t) => (t.score = starts.get(t.id) + t.actTargets[a] + t.pending));
        paint();
        if (!skipped) await sleep(550);
      }

      paint();
      await sleep(500);

      const playerScore = teams.find((t) => t.isPlayer).score;
      const goatScore = teams.find((t) => !t.isPlayer).score;
      const playerWon = playerScore > goatScore;
      const playerAvg = teamAverage(game.crew);

      root().innerHTML = "";
      const resultView = el(`
        <section class="screen fest-result goat-round-result" style="--accent:${fest.accent}">
          <p class="kicker">GOAT Challenge · Round ${round}</p>
          <div class="result-verdict ${playerWon ? "win" : "bad"}">
            <span class="verdict-medal">${playerWon ? "✅" : "❌"}</span>
            <div>
              <h2>${playerWon ? "Round won!" : "Round lost!"}</h2>
              <p class="verdict-sub muted">You: ${fmt(playerScore)} · Cinema GOAT: ${fmt(goatScore)}</p>
            </div>
          </div>
          <ol class="final-board">
            <li class="fb-row ${playerWon ? "is-player" : "is-goat"}">
              <span class="fb-rank">${playerWon ? "🏆" : "2"}</span>
              <span class="fb-flag">🎬</span>
              <span class="fb-name">Your Crew</span>
              <span class="fb-score">${fmt(playerScore)}</span>
            </li>
            <li class="fb-row ${!playerWon ? "is-goat" : ""}">
              <span class="fb-rank">${!playerWon ? "🏆" : "2"}</span>
              <span class="fb-flag">🐐</span>
              <span class="fb-name">Cinema GOAT</span>
              <span class="fb-score">${fmt(goatScore)}</span>
            </li>
          </ol>

          <div class="crew-comparison">
            <h4>Crew Comparison</h4>
            <div class="comparison-row">
              <span>Your Crew avg</span>
              <span class="rt-${ratingTier(playerAvg)}"><b>${playerAvg.toFixed(1)}</b></span>
            </div>
            <div class="comparison-row">
              <span>Cinema GOAT avg</span>
              <span><b>93.5</b></span>
            </div>
          </div>
          <button class="btn btn-goat btn-xl" id="continueGoat">
            ${(playerWon ? playerWins + 1 : playerWins) === 2 || (!playerWon ? goatWins + 1 : goatWins) === 2
              ? "See final result →"
              : "Next round →"}
          </button>
        </section>
      `);
      resultView.querySelector("#continueGoat").addEventListener("click", () => resolve(playerWon ? "player" : "goat"));
      root().appendChild(resultView);
    })();
  });
}

function renderGoatResult(playerWins, goatWins) {
  root().innerHTML = "";
  const won = playerWins >= 2;
  const view = el(`
    <section class="screen game-over ${won ? "goat-win" : "goat-fail"}">
      <div class="intro-glow"></div>
      <p class="kicker">GOAT Challenge · Final Result</p>
      ${won
        ? `<h1 class="slam-verdict win">🐐 GOAT STATUS ACHIEVED</h1>
           <p class="slam-tagline">"You are the greatest producer in the history of cinema."</p>`
        : `<h1 class="slam-verdict fail">🎬 The GOAT remains undefeated</h1>
           <p class="slam-tagline">You won ${playerWins} round${playerWins !== 1 ? "s" : ""} — the GOAT won ${goatWins}. Return with a stronger crew.</p>`
      }
      <div class="goat-score-summary">
        <div class="goat-score-box ${won ? "win" : ""}">
          <span class="gsb-label">Your Crew</span>
          <span class="gsb-score">${playerWins}</span>
        </div>
        <div class="goat-score-sep">–</div>
        <div class="goat-score-box ${!won ? "win" : ""}">
          <span class="gsb-label">Cinema GOAT</span>
          <span class="gsb-score">${goatWins}</span>
        </div>
      </div>
      <button class="btn btn-primary btn-xl" id="restart">↺ Play again</button>
    </section>
  `);
  view.querySelector("#restart").addEventListener("click", () => { deleteSave(); deleteSubmitKeys(); location.reload(); });
  root().appendChild(view);
  if (won) setTimeout(() => launchConfetti("goat"), 400);
}
// Build the shareable text card summarising crew, festivals won and per-season
// scores, then wire X / Facebook / clipboard buttons to it.
function shareCardText(tallyRows, grandSlam) {
  const wins = game.results.filter((r) => r.won).length;
  const lines = [];
  lines.push(
    grandSlam
      ? "🏆 I achieved the CINEMA GRAND SLAM in Cinema Grand Slam!"
      : `🎬 My Cinema Grand Slam career: ${conqueredCount(tallyRows)} of ${FESTIVALS.length} majors conquered.`
  );
  if (tallyRows.length) {
    lines.push("");
    lines.push("Festivals won:");
    tallyRows.forEach(([name, info]) => lines.push(`• ${name} × ${info.count}`));
  }
  lines.push("");
  lines.push(`Total ${wins} wins · Grand total ${fmt(game.grandTotal)} pts`);
  if (game.seasonScores.length) {
    lines.push(
      "Per season: " + game.seasonScores.map((s, i) => `S${i + 1} ${fmt(s)}`).join(" · ")
    );
  }
  const star = bestCrewMember();
  if (star) lines.push(`Crew MVP: ${star.name} (${star.rating})`);
  return lines.join("\n");
}

function conqueredCount() {
  return FESTIVALS.filter((f) => game.conquered.has(f.key)).length;
}

function bestCrewMember() {
  const members = Object.values(game.crew);
  if (!members.length) return null;
  return members.slice().sort((a, b) => b.rating - a.rating)[0];
}

function wireShareButtons(view, tallyRows, grandSlam) {
  const text = shareCardText(tallyRows, grandSlam);
  const url = location.href;
  const tw = view.querySelector("#shareTwitter");
  const fb = view.querySelector("#shareFacebook");
  const cp = view.querySelector("#shareCopy");
  if (tw)
    tw.addEventListener("click", () =>
      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
        "_blank",
        "noopener"
      )
    );
  if (fb)
    fb.addEventListener("click", () =>
      window.open(
        `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(text)}`,
        "_blank",
        "noopener"
      )
    );
  if (cp)
    cp.addEventListener("click", async () => {
      const payload = `${text}\n${url}`;
      try {
        await navigator.clipboard.writeText(payload);
        flashToast("📋 Career card copied to clipboard!");
      } catch {
        // Clipboard API unavailable (e.g. insecure context) — fall back to a prompt.
        window.prompt("Copy your career card:", payload);
      }
    });
}

// ── toast ───────────────────────────────────────────────────────────────────
let toastTimer = null;
function flashToast(msg) {
  let t = $("#toast");
  if (!t) {
    t = el(`<div id="toast" class="toast"></div>`);
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

// ── boot ──────────────────────────────────────────────────────────────────
renderIntro();
