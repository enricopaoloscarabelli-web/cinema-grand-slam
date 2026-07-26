// ─────────────────────────────────────────────────────────────────────────
// Cinema Grand Slam — 1vs1 LOCAL mode (same device, "hot-seat")
//
// Two players share one device and build TWO separate crews from the same
// stream of drawn rosters, then compete together (each against the other
// AND two random AI teams) across the same 6-festival x 3-season circuit as
// the single-player campaign. This module is intentionally self-contained:
// it reuses the shared scoring engine (festivals.js / events.js /
// decisions.js — identical rules, so nothing is unfair between modes) but
// keeps its own state and its own screens, so it can't interfere with the
// single-player save/game state in app.js.
//
// Entry point: startVsMode(onExit) — onExit is called whenever the player
// backs out to the main menu (renderIntro in app.js).
//
// KNOWN SIMPLIFICATIONS (v1):
//   • No mid-run save — closing/reloading the tab loses the match.
//   • No transfer window between seasons (each season replays the same 6
//     festivals with the crews drafted at the very start).
//   • No difficulty picker — scoring always uses the "expert" (non-easy)
//     bonus divisors, same as normal/master single-player mode.
//   • No GOAT challenge.
// ─────────────────────────────────────────────────────────────────────────

import { ROLES, ROSTERS, BONUS_LABELS } from "./data.js";
import { FESTIVALS, ACTS, scoreBreakdown, teamAverage, bonusTags, componentContributions } from "./festivals.js";
import { rollEvent, eventDelta } from "./events.js";
import { DECISIONS } from "./decisions.js";

const TOTAL_SEASONS = 3;
const FEST_BY_KEY = Object.fromEntries(FESTIVALS.map((f) => [f.key, f]));
const COMPLETE_ROSTERS = ROSTERS.filter((r) => r.missing.length === 0);

// ── tiny helpers (kept local to avoid touching app.js's internals) ────────
const $ = (sel, r = document) => r.querySelector(sel);
const root = () => $("#app");
const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const fmt = (n) => Math.round(n).toLocaleString("en-US");

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function ratingTier(n) {
  const r = Math.round(n);
  if (r >= 90) return "gold";
  if (r >= 85) return "blue";
  if (r >= 75) return "green";
  if (r >= 65) return "orange";
  return "red";
}

function bonusChipsHTML(bonuses) {
  if (!bonuses || !bonuses.length) return "";
  return bonuses
    .map((b) => `<span class="bonus-tag bonus-${b}"><i class="bonus bonus-${b}"></i>${BONUS_LABELS[b] || b}</span>`)
    .join("");
}

function bonusTagsHTML(tags) {
  if (!tags.length) return `<span class="muted small">no bonuses</span>`;
  return tags
    .map(
      (b) =>
        `<span class="bonus-tag bonus-${b.type}"><i class="bonus bonus-${b.type}"></i>${BONUS_LABELS[b.type]}${
          b.count > 1 ? ` ×${b.count}` : ""
        }</span>`
    )
    .join("");
}

function rosterToTeam(roster) {
  const map = {};
  for (const m of roster.members) map[m.role] = m;
  return map;
}

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

// ── match state ─────────────────────────────────────────────────────────
let vs = null;

function mkPlayer(name, tag) {
  return {
    name,
    tag, // "P1" | "P2" — used for element ids / flags
    crew: {},
    festivalRep: Object.fromEntries(FESTIVALS.map((f) => [f.key, 0])),
    usedDecisions: new Set(),
    conquered: new Set(),
    grandTotal: 0,
    festivalsWon: 0,
    results: [], // [{festKey, season, rank, score}]
  };
}

function freshVsState() {
  return {
    usedNames: new Set(), // every historical figure drafted so far, by EITHER player — no repeats across the whole match
    usedRosterIds: new Set(),
    seasonUsedRivalIds: new Set(),
    turnPlayer: 1,
    currentRoster: null,
    season: 1,
    festivalIndex: 0,
    p1: mkPlayer("Player 1", "P1"),
    p2: mkPlayer("Player 2", "P2"),
  };
}

function vsCrewSize(p) {
  return Object.keys(p.crew).length;
}
function vsCrewComplete(p) {
  return ROLES.every((r) => p.crew[r]);
}
function vsCrewAverage(p) {
  const total = ROLES.reduce((a, r) => a + (p.crew[r] ? p.crew[r].rating : 0), 0);
  return total / ROLES.length;
}
function vsIsPickable(member, p) {
  if (vs.usedNames.has(member.name)) return false;
  return !p.crew[member.role];
}
function vsCanFill(roster, p) {
  return roster.members.some((m) => vsIsPickable(m, p));
}

// Whoever should draw THIS round. Alternates normally; if one player has
// already completed their crew, the other keeps drawing alone.
function vsNextDrawer() {
  const p1done = vsCrewComplete(vs.p1);
  const p2done = vsCrewComplete(vs.p2);
  if (p1done && p2done) return null;
  if (p1done) return vs.p2;
  if (p2done) return vs.p1;
  return vs.turnPlayer === 1 ? vs.p1 : vs.p2;
}
function vsOtherFor(drawer) {
  const cand = drawer === vs.p1 ? vs.p2 : vs.p1;
  return vsCrewComplete(cand) ? null : cand;
}

function drawUniqueRosterFor(drawer) {
  // Never repeat a roster within the match; if the pool runs dry, reopen it.
  // Skip any roster that has literally nothing the drawer can pick — that's
  // the ONLY situation a redraw happens, and it's automatic/invisible.
  let pool = ROSTERS.filter((r) => !vs.usedRosterIds.has(r.id));
  if (!pool.length) {
    vs.usedRosterIds.clear();
    pool = ROSTERS.slice();
  }
  let candidates = pool.filter((r) => vsCanFill(r, drawer));
  if (!candidates.length) {
    // Extremely rare (drawer needs roles no un-used roster offers). Widen
    // the search to the full roster list as a last resort.
    candidates = ROSTERS.filter((r) => vsCanFill(r, drawer));
  }
  if (!candidates.length) return null; // truly nothing left to draw — draft is effectively over for this drawer
  const chosen = pick(candidates);
  vs.usedRosterIds.add(chosen.id);
  return chosen;
}

// ── SCREEN: name entry ─────────────────────────────────────────────────
export function startVsMode(onExit) {
  vs = freshVsState();
  renderVsNames(onExit);
}

function vsHeader(kicker) {
  return `
    <div class="vs-topbar">
      <button class="btn-home" id="vsHome" title="Exit match">🏠</button>
      <span class="vs-kicker">${kicker}</span>
    </div>`;
}

function wireVsHome(view, onExit) {
  const btn = view.querySelector("#vsHome");
  if (btn)
    btn.addEventListener("click", () => {
      if (confirm("Exit the 1vs1 match? Progress isn't saved and will be lost.")) onExit();
    });
}

function renderVsNames(onExit) {
  root().innerHTML = "";
  const view = el(`
    <section class="screen intro vs-screen">
      ${vsHeader("1vs1 Local · Setup")}
      <div class="intro-glow"></div>
      <h1 class="title">1vs1<span> Local Grand Slam</span></h1>
      <p class="lede">
        Same device, two producers. Take turns building your crews from the same
        stream of drawn rosters, then face off — plus two random rival studios —
        across all six major festivals, three seasons running.
      </p>
      <div class="player-name-box">
        <label class="player-name-label" for="vsName1">🅰️ Player 1 name</label>
        <input class="player-name-input" id="vsName1" type="text" maxlength="24" placeholder="Player 1" autocomplete="off" />
      </div>
      <div class="player-name-box">
        <label class="player-name-label" for="vsName2">🅱️ Player 2 name</label>
        <input class="player-name-input" id="vsName2" type="text" maxlength="24" placeholder="Player 2" autocomplete="off" />
      </div>
      <button class="btn btn-primary btn-xl" id="vsStart">⚔️ Start Draft</button>
      <p class="nolan-note"><i>Whoever draws a roster always picks first from it — the other player picks second, from what's left.</i></p>
    </section>
  `);
  view.querySelector("#vsStart").addEventListener("click", () => {
    const n1 = view.querySelector("#vsName1").value.trim();
    const n2 = view.querySelector("#vsName2").value.trim();
    if (n1) vs.p1.name = n1;
    if (n2) vs.p2.name = n2;
    renderVsDraft(onExit);
  });
  wireVsHome(view, onExit);
  root().appendChild(view);
}

// ── SCREEN: draft ──────────────────────────────────────────────────────
function vsCrewStripHTML(p, label) {
  return `
    <div class="vs-crew-col">
      <h4 class="vs-crew-col-title">${label} <span class="muted small">${vsCrewSize(p)}/15</span></h4>
      <div class="crew-strip vs-crew-strip">
        ${ROLES.map((role) => {
          const m = p.crew[role];
          return `
            <div class="crew-slot ${m ? "filled" : "empty"}">
              <div class="slot-top">
                <span class="slot-role">${role}</span>
                ${m ? `<span class="slot-rating rt-${ratingTier(m.rating)}">${m.rating}</span>` : ""}
              </div>
              <span class="slot-name">${m ? m.name : "—"}</span>
              ${m && m.bonuses.length ? `<span class="slot-bonuses">${bonusChipsHTML(m.bonuses)}</span>` : ""}
            </div>`;
        }).join("")}
      </div>
    </div>`;
}

function renderVsDraft(onExit) {
  root().innerHTML = "";
  const drawer = vsNextDrawer();
  if (!drawer) {
    renderVsCrewsComplete(onExit);
    return;
  }
  const view = el(`
    <section class="screen draft vs-screen">
      ${vsHeader("1vs1 Local · Draft phase")}
      <header class="draft-head">
        <div>
          <p class="kicker vs-turn-banner">🎬 ${drawer.name}'s turn to draw</p>
          <h2>Whoever draws picks first — the other picks second, from what's left.</h2>
        </div>
      </header>

      <div class="draft-stage">
        <div class="reel-wrap" id="reelWrap">
          <p class="reel-caption" id="reelCaption">Draw a historical roster to keep building your crews.</p>
          <div class="draft-actions">
            <button class="btn btn-primary btn-lg" id="drawBtn">🎰 Draw Team</button>
          </div>
        </div>
        <aside class="roster-pane" id="rosterPane"></aside>
      </div>

      <div class="vs-split">
        ${vsCrewStripHTML(vs.p1, `🅰️ ${vs.p1.name}`)}
        ${vsCrewStripHTML(vs.p2, `🅱️ ${vs.p2.name}`)}
      </div>
    </section>
  `);
  view.querySelector("#drawBtn").addEventListener("click", () => vsDrawTeam(drawer, view, onExit));
  wireVsHome(view, onExit);
  root().appendChild(view);
}

async function vsDrawTeam(drawer, view, onExit) {
  const btn = view.querySelector("#drawBtn");
  if (btn) btn.disabled = true;
  const cap = view.querySelector("#reelCaption");
  if (cap) cap.textContent = "🎰 Drawing…";
  const wrap = view.querySelector("#reelWrap");
  if (wrap) wrap.classList.add("spinning");
  await sleep(650);
  if (wrap) wrap.classList.remove("spinning");

  const chosen = drawUniqueRosterFor(drawer);
  vs.currentRoster = chosen;
  if (cap) cap.textContent = chosen ? `Drew: ${chosen.flag} ${chosen.name}` : "No roster left to draw.";
  if (!chosen) {
    flashToast("No usable roster left — moving on.");
    renderVsDraft(onExit);
    return;
  }
  renderVsRosterPane(chosen, drawer, "primary", onExit);
}

function renderVsRosterPane(roster, actingPlayer, phase, onExit) {
  // phase: "primary" (drawer picks) | "secondary" (other player picks)
  const pane = $("#rosterPane");
  if (!pane) return;
  pane.innerHTML = `
    <div class="roster-card" style="--accent:#e7c66b">
      <div class="roster-card-head">
        <span class="roster-flag">${roster.flag}</span>
        <div>
          <h3>${roster.name}</h3>
          <p class="muted">${roster.missing.length ? `Missing: ${roster.missing.join(", ")}` : "Complete roster"}</p>
        </div>
      </div>
      <p class="vs-pick-banner">${phase === "primary" ? "🅰️" : "🅱️"} <b>${actingPlayer.name}</b>, pick one:</p>
      <ul class="member-list">
        ${roster.members
          .map((m) => {
            const pickable = vsIsPickable(m, actingPlayer);
            const takenByRun = vs.usedNames.has(m.name);
            const roleFull = actingPlayer.crew[m.role];
            return `
            <li class="member ${pickable ? "pickable" : "locked"}" data-name="${encodeURIComponent(m.name)}">
              <div class="m-main">
                <span class="m-role">${m.role}</span>
                <span class="m-name">${m.name}</span>
                ${m.bonuses.length ? `<span class="m-bonuses">${bonusChipsHTML(m.bonuses)}</span>` : ""}
              </div>
              <span class="m-rating rt-${ratingTier(m.rating)}" title="Rating">${m.rating}</span>
              <span class="m-status">${
                pickable ? "Pick" : takenByRun ? "Already drafted" : roleFull ? "Role filled" : "—"
              }</span>
            </li>`;
          })
          .join("")}
      </ul>
    </div>
  `;
  pane.querySelectorAll(".member.pickable").forEach((li) => {
    li.addEventListener("click", () => {
      const name = decodeURIComponent(li.dataset.name);
      const member = roster.members.find((m) => m.name === name);
      if (member) vsPickMember(member, roster, actingPlayer, phase, onExit);
    });
  });
}

function vsPickMember(member, roster, actingPlayer, phase, onExit) {
  const entry = { ...member, from: roster.name };
  actingPlayer.crew[member.role] = entry;
  vs.usedNames.add(member.name);
  flashToast(`✅ ${member.name} drafted as ${member.role} — ${actingPlayer.name}`);

  if (phase === "primary") {
    const other = vsOtherFor(actingPlayer);
    const remainingRoster = { ...roster, members: roster.members.filter((m) => m.role !== member.role) };
    if (other && remainingRoster.members.some((m) => vsIsPickable(m, other))) {
      renderVsRosterPane(remainingRoster, other, "secondary", onExit);
      return;
    }
  }

  // Round over: alternate whose turn it is to draw next, then re-render.
  vs.turnPlayer = vs.turnPlayer === 1 ? 2 : 1;
  vs.currentRoster = null;
  if (vsCrewComplete(vs.p1) && vsCrewComplete(vs.p2)) {
    renderVsCrewsComplete(onExit);
  } else {
    renderVsDraft(onExit);
  }
}

// ── SCREEN: both crews complete ────────────────────────────────────────
function renderVsCrewsComplete(onExit) {
  root().innerHTML = "";
  const view = el(`
    <section class="screen crew-complete vs-screen">
      ${vsHeader("1vs1 Local · Crews assembled")}
      <div class="intro-glow"></div>
      <h1 class="title">Both crews are ready</h1>
      <p class="lede">Time to find out who's really the greatest producer in the room.</p>
      <div class="vs-split">
        ${vsCrewStripHTML(vs.p1, `🅰️ ${vs.p1.name} · avg ${vsCrewAverage(vs.p1).toFixed(1)}`)}
        ${vsCrewStripHTML(vs.p2, `🅱️ ${vs.p2.name} · avg ${vsCrewAverage(vs.p2).toFixed(1)}`)}
      </div>
      <button class="btn btn-primary btn-xl" id="vsBegin">🏆 Begin the Grand Slam ▸</button>
    </section>
  `);
  view.querySelector("#vsBegin").addEventListener("click", () => {
    vs.season = 1;
    vs.festivalIndex = 0;
    vs.seasonUsedRivalIds = new Set();
    vsEnterFestival(onExit);
  });
  wireVsHome(view, onExit);
  root().appendChild(view);
}

// ── decisions (independent per player) ─────────────────────────────────
function vsRollDecision(player) {
  const poolAll = DECISIONS.filter((d) => !player.usedDecisions.has(d.id));
  if (!poolAll.length) return null;
  if (Math.random() > 0.6) return null;
  return pick(poolAll);
}

function vsCurrentFestival() {
  return FESTIVALS[vs.festivalIndex];
}

function vsEffectChipsHTML(effect) {
  return Object.entries(effect)
    .map(([rawKey, v]) => {
      const key = rawKey === "target" ? vsCurrentFestival().key : rawKey;
      const f = FEST_BY_KEY[key];
      const label = rawKey === "target" ? `${f.icon} ${f.name} (this fest)` : `${f.icon} ${f.name}`;
      return `<span class="eff ${v > 0 ? "up" : "down"}">${label} ${v > 0 ? "+" : ""}${v}</span>`;
    })
    .join("");
}

function renderVsDecision(player, decision, onContinue, onExit) {
  player.usedDecisions.add(decision.id);
  root().innerHTML = "";
  const fest = vsCurrentFestival();
  const view = el(`
    <section class="screen decision-screen vs-screen">
      ${vsHeader(`Season ${vs.season} · ${player.name}'s dilemma · ${fest.icon} ${fest.name} next`)}
      <div class="decision-card">
        <div class="decision-head">
          <span class="decision-icon">${decision.icon}</span>
          <h2 class="decision-title">${decision.title}</h2>
        </div>
        <p class="decision-desc">${decision.description}</p>
        <div class="decision-choices" id="choiceList"></div>
        <p class="decision-foot muted small">Each choice helps some festivals and hurts others — there is no safe option.</p>
      </div>
    </section>
  `);
  const list = view.querySelector("#choiceList");
  decision.choices.forEach((choice) => {
    const btn = el(`
      <button class="decision-choice">
        <span class="choice-text">${choice.text}</span>
        <span class="choice-effects">${vsEffectChipsHTML(choice.effect)}</span>
      </button>`);
    btn.addEventListener("click", () => vsResolveChoice(player, decision, choice, onContinue));
    list.appendChild(btn);
  });
  wireVsHome(view, onExit);
  root().appendChild(view);
}

function vsResolveChoice(player, decision, choice, onContinue) {
  const deltaStr = vsEffectChipsHTML(choice.effect);
  for (const [rawKey, v] of Object.entries(choice.effect)) {
    const key = rawKey === "target" ? vsCurrentFestival().key : rawKey;
    if (key in player.festivalRep) player.festivalRep[key] += v;
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
      <button class="btn btn-primary btn-lg" id="decisionContinue">Continue ▸</button>
    `;
    card.querySelector("#decisionContinue").addEventListener("click", onContinue);
  } else {
    onContinue();
  }
}

// ── festival flow ───────────────────────────────────────────────────────
function vsPickFestivalRivals(n) {
  const used = vs.seasonUsedRivalIds;
  let poolSrc = COMPLETE_ROSTERS.filter((r) => !used.has(r.id));
  if (poolSrc.length < n) {
    used.clear();
    poolSrc = COMPLETE_ROSTERS.slice();
  }
  const pool = poolSrc.slice();
  const out = [];
  while (out.length < n && pool.length) {
    const [r] = pool.splice(Math.floor(Math.random() * pool.length), 1);
    out.push(r);
    used.add(r.id);
  }
  return out;
}

function vsEnterFestival(onExit) {
  const d1 = vsRollDecision(vs.p1);
  const afterP1 = () => {
    const d2 = vsRollDecision(vs.p2);
    if (d2) {
      renderVsDecision(vs.p2, d2, () => renderVsFestivalIntro(onExit), onExit);
    } else {
      renderVsFestivalIntro(onExit);
    }
  };
  if (d1) {
    renderVsDecision(vs.p1, d1, afterP1, onExit);
  } else {
    afterP1();
  }
}

let vsFestRivals = [];

function vsLineup() {
  const rows = [
    { name: `🅰️ ${vs.p1.name}`, flag: "🅰️", avg: vsCrewAverage(vs.p1), tags: bonusTags(vs.p1.crew), isPlayer: true },
    { name: `🅱️ ${vs.p2.name}`, flag: "🅱️", avg: vsCrewAverage(vs.p2), tags: bonusTags(vs.p2.crew), isPlayer: true },
    ...vsFestRivals.map((r) => ({
      name: r.name,
      flag: r.flag,
      avg: teamAverage(rosterToTeam(r)),
      tags: bonusTags(rosterToTeam(r)),
      isPlayer: false,
    })),
  ];
  return rows.sort((a, b) => b.avg - a.avg);
}

function renderVsFestivalIntro(onExit) {
  const fest = vsCurrentFestival();
  vsFestRivals = vsPickFestivalRivals(2);
  root().innerHTML = "";
  const lineup = vsLineup();
  const view = el(`
    <section class="screen fest-intro vs-screen" style="--accent:${fest.accent}">
      ${vsHeader(`Season ${vs.season} · Festival ${vs.festivalIndex + 1} of ${FESTIVALS.length}`)}
      <div class="fest-badge">${fest.icon}</div>
      <h2 class="fest-name">${fest.name}</h2>
      <p class="fest-city">${fest.city}</p>
      <p class="fest-guidance">🎯 ${fest.guidance}</p>

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
  view.querySelector("#startFest").addEventListener("click", () => vsRunFestival(fest, onExit));
  wireVsHome(view, onExit);
  root().appendChild(view);
}

function vsBuildFestivalTeams(fest) {
  const teams = [];
  [vs.p1, vs.p2].forEach((p) => {
    const b = scoreBreakdown(p.crew, fest, false);
    const repPerAct = (p.festivalRep[fest.key] || 0) / 3;
    teams.push({
      id: p.tag,
      name: p.name,
      flag: p.tag === "P1" ? "🅰️" : "🅱️",
      isPlayer: true,
      player: p,
      actTargets: b.acts.map((a) => Math.max(0, a + repPerAct)),
      members: Object.values(p.crew),
      score: 0,
      pending: 0,
    });
  });
  for (const r of vsFestRivals) {
    const team = rosterToTeam(r);
    const b = scoreBreakdown(team, fest);
    const form = rand(0.96, 1.15);
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

async function vsRunFestival(fest, onExit) {
  const teams = vsBuildFestivalTeams(fest);
  let skipped = false;

  root().innerHTML = "";
  const view = el(`
    <section class="screen fest-live vs-screen" style="--accent:${fest.accent}">
      ${vsHeader(`Season ${vs.season} · LIVE`)}
      <header class="live-head">
        <div class="live-title">
          <span class="fest-badge sm">${fest.icon}</span>
          <div><h2>${fest.name}</h2></div>
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
  }

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
        if (t >= 1) return resolve();
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
  vsFinishFestival(fest, teams, onExit);
}

function vsScoreRecapHTML(team, fest, label) {
  const rows = componentContributions(team, fest, false);
  const maxPts = Math.max(0.001, ...rows.map((r) => r.points));
  return `
    <div class="score-recap">
      <h3>${label} — what mattered at ${fest.name}</h3>
      <div class="recap-rows">
        ${rows
          .map(
            (r) => `
          <div class="recap-row">
            <span class="recap-ic">${r.icon}</span>
            <span class="recap-label">${r.label}</span>
            <div class="recap-bar-track"><div class="recap-bar-fill" style="width:${(r.points / maxPts) * 100}%"></div></div>
            <span class="recap-pts">${r.points.toFixed(1)}</span>
          </div>`
          )
          .join("")}
      </div>
    </div>`;
}

function vsFinishFestival(fest, teams, onExit) {
  const ranked = [...teams].sort((a, b) => b.score - a.score);
  const winner = ranked[0];

  [vs.p1, vs.p2].forEach((p) => {
    const t = teams.find((tm) => tm.player === p);
    const rank = ranked.indexOf(t) + 1;
    p.grandTotal += t.score;
    p.results.push({ festKey: fest.key, season: vs.season, rank, score: t.score });
    if (winner.player === p) {
      p.conquered.add(fest.key);
      p.festivalsWon += 1;
    }
  });

  root().innerHTML = "";
  const view = el(`
    <section class="screen fest-result vs-screen" style="--accent:${fest.accent}">
      ${vsHeader(`Season ${vs.season} · ${fest.name} — Final result`)}
      <p class="kicker">${fest.icon} ${fest.name} — Final result</p>
      <ol class="final-board">
        ${ranked
          .map(
            (t, i) => `
          <li class="fb-row ${t.isPlayer ? "is-player" : ""} ${i === 0 ? "is-goat" : ""}">
            <span class="fb-rank">${i === 0 ? "🏆" : i + 1}</span>
            <span class="fb-flag">${t.flag}</span>
            <span class="fb-name">${t.name}</span>
            <span class="fb-score">${fmt(t.score)}</span>
          </li>`
          )
          .join("")}
      </ol>
      <div class="vs-split">
        ${vsScoreRecapHTML(vs.p1.crew, fest, `🅰️ ${vs.p1.name}`)}
        ${vsScoreRecapHTML(vs.p2.crew, fest, `🅱️ ${vs.p2.name}`)}
      </div>
      <button class="btn btn-primary btn-xl" id="vsContinue">Continue ▸</button>
    </section>
  `);
  view.querySelector("#vsContinue").addEventListener("click", () => vsAdvance(onExit));
  wireVsHome(view, onExit);
  root().appendChild(view);
}

function vsAdvance(onExit) {
  vs.festivalIndex += 1;
  if (vs.festivalIndex < FESTIVALS.length) {
    vsEnterFestival(onExit);
    return;
  }
  // Season done.
  if (vs.season < TOTAL_SEASONS) {
    vs.season += 1;
    vs.festivalIndex = 0;
    vs.seasonUsedRivalIds = new Set();
    vsEnterFestival(onExit);
  } else {
    renderVsFinalResult(onExit);
  }
}

// ── SCREEN: final result ───────────────────────────────────────────────
function renderVsFinalResult(onExit) {
  const p1 = vs.p1;
  const p2 = vs.p2;
  let winner = null;
  if (p1.grandTotal !== p2.grandTotal) {
    winner = p1.grandTotal > p2.grandTotal ? p1 : p2;
  } else if (p1.conquered.size !== p2.conquered.size) {
    winner = p1.conquered.size > p2.conquered.size ? p1 : p2;
  } else if (p1.festivalsWon !== p2.festivalsWon) {
    winner = p1.festivalsWon > p2.festivalsWon ? p1 : p2;
  }

  root().innerHTML = "";
  const view = el(`
    <section class="screen game-over vs-screen ${winner ? "goat-win" : ""}">
      ${vsHeader("1vs1 Local · Final Result")}
      <div class="intro-glow"></div>
      <p class="kicker">1vs1 Local · after ${TOTAL_SEASONS} seasons</p>
      ${
        winner
          ? `<h1 class="slam-verdict win">🏆 ${winner.name} wins the Grand Slam!</h1>`
          : `<h1 class="slam-verdict win">🤝 It's a tie!</h1>`
      }
      <div class="vs-split">
        ${vsFinalCardHTML(p1, "🅰️")}
        ${vsFinalCardHTML(p2, "🅱️")}
      </div>
      <button class="btn btn-primary btn-xl" id="vsExit">↺ Back to menu</button>
    </section>
  `);
  view.querySelector("#vsExit").addEventListener("click", () => onExit());
  root().appendChild(view);
}

function vsFinalCardHTML(p, flag) {
  return `
    <div class="vs-final-card">
      <h3>${flag} ${p.name}</h3>
      <div class="goat-score-box">
        <span class="gsb-label">Grand total</span>
        <span class="gsb-score">${fmt(p.grandTotal)}</span>
      </div>
      <p class="muted small">Festivals conquered: ${p.conquered.size ? [...p.conquered].map((k) => FEST_BY_KEY[k].icon).join(" ") : "none"}</p>
      <p class="muted small">Festival wins: ${p.festivalsWon} / ${FESTIVALS.length * TOTAL_SEASONS}</p>
    </div>`;
}
