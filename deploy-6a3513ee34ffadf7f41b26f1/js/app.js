<FILE file_path="/home/workdir/attachments/app.js">
// ─────────────────────────────────────────────────────────────────────────
// Cinema Siqueiros — game controller
//
// ... (tutto il codice originale fino a renderGoatIntro) ...

// ── GOAT CHALLENGE ─────────────────────────────────────────────────────────

function renderGoatIntro() {
  root().innerHTML = "";
  const view = el(`
    <section class="screen goat-intro">
      <div class="intro-glow"></div>
      <p class="kicker">Bonus Challenge</p>
      <h1 class="goat-title">🐐 THE GOAT CHALLENGE</h1>
      <p class="goat-sub">You conquered every festival. But one final opponent stands between you and immortality.</p>
      <div class="goat-rival-card">
        <div class="goat-rival-label">Your opponent</div>
        <div class="goat-rival-name">🎬 Cinema GOAT</div>
        <div class="goat-rival-desc">The greatest film crew ever assembled. Masterful craft across the board.</div>
        <div class="goat-rival-stats">
          <span>Avg rating: <b>93.5</b></span>
          <span>Bonuses: none</span>
        </div>
      </div>
      <div class="goat-format">
        <h3>Format: Best of 3</h3>
        <p>Three rounds at the GOAT Awards. Win 2 to claim the title of Greatest Producer in Cinema History.</p>
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
  const pb = scoreBreakdown(playerTeam, fest, game.isEasyMode);
  const gb = scoreBreakdown(GOAT_TEAM, fest);

  const playerAvg = crewAverage();

  // Player form boost (stronger if avg >= 90)
  let playerForm = rand(0.97, 1.06);
  if (playerAvg >= 90) {
    playerForm = rand(1.02, 1.12);
  }
  // GOAT form lowered
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

      root().innerHTML = "";
      const resultView = el(`
        <section class="screen fest-result goat-round-result" style="--accent:${fest.accent}">
          <p class="kicker">GOAT Challenge · Round ${round}</p>
          <div class="result-verdict ${playerWon ? "win" : "bad"}">
            <span class="verdict-medal">${playerWon ? "✅" : "❌"}</span>
            <div>
              <h2>${playerWon ? "Round won!" : "Round lost!"}</h2>
              <p class="verdict-sub muted">You: ${fmt(playerScore)} · Cinema GOAT: ${fmt(goatScore)}</p>
              <p class="crew-comparison">Your crew avg: <b class="rt-${ratingTier(playerAvg)}">${playerAvg.toFixed(1)}</b> vs GOAT 93.5</p>
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
  view.querySelector("#restart").addEventListener("click", () => location.reload());
  root().appendChild(view);
}

// ... (resto del file invariato fino alla fine) ...

// ── boot ──────────────────────────────────────────────────────────────────
renderIntro();
</FILE>
