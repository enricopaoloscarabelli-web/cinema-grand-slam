// ─────────────────────────────────────────────────────────────────────────
// Cinema Grand Slam — interactive decision events ("producer's dilemmas")
//
// A SEPARATE layer from the random in-festival drama (see events.js). One of
// these fires occasionally BEFORE a festival and pauses the game to ask the
// player to make a call. Each dilemma presents three choices, and every choice
// shifts the production's standing at SPECIFIC festivals — never all of them.
//
// ── THE SACRIFICE-BASED TRIANGULAR SYSTEM ──────────────────────────────────
// Every option in this file obeys one mandatory rule:
//
//   • it BUFFS exactly two festivals  (one strong, one moderate)
//   • it NERFS exactly two festivals  (one strong, one moderate)
//   • the remaining two festivals are left untouched
//
// There is NO neutral choice, no "+5 to all", no "no penalty" escape hatch.
// Picking an option is picking a cinema philosophy — auteur, commercial or
// political — and accepting what that philosophy costs you elsewhere. The
// player should always feel "I am choosing a vision of cinema," not "I am
// shopping for a stat bonus."
//
// An `effect` is a map of festival-key -> points, where the key is one of:
//   "cannes" | "venice" | "berlin" | "oscars" | "locarno" | "sundance"
// These points accumulate as per-festival reputation and are folded into the
// player's score at the matching festival. The gains and losses are shown
// BEFORE the player commits, so every dilemma reads as strategy, not luck.
//
// Magnitudes are fixed by `choice()` so balance stays consistent across all
// 40 events: the strong buff/nerf is larger than the moderate one, and the
// buff total slightly exceeds the nerf total (a small reward for committing
// to an identity rather than dithering). Tune STRONG/MILD here to rebalance
// the entire system at once.
// ─────────────────────────────────────────────────────────────────────────

const STRONG_BUFF = 14;
const MILD_BUFF = 9;
const STRONG_NERF = -11;
const MILD_NERF = -8;

// Build one triangular choice. `buffs` and `nerfs` are each [strong, mild]
// festival keys. The first entry in each pair is the dominant one.
function choice(text, buffs, nerfs, flavour) {
  const effect = {};
  buffs.forEach((k, i) => (effect[k] = i === 0 ? STRONG_BUFF : MILD_BUFF));
  nerfs.forEach((k, i) => (effect[k] = i === 0 ? STRONG_NERF : MILD_NERF));
  return { text, effect, flavour };
}

export const DECISIONS = [
  // ── CATEGORY 1 — PRODUCTION ──────────────────────────────────────────────
  {
    id: "budget_crisis",
    category: "Production",
    icon: "💸",
    title: "Budget Crisis",
    description: "Production is 30% over budget and the money men are circling.",
    choices: [
      choice("Reduce shooting days", ["oscars", "berlin"], ["cannes", "venice"],
        "A leaner, tighter shoot — but the painterly long takes are the first to go."),
      choice("Request studio funding", ["cannes", "oscars"], ["locarno", "sundance"],
        "The majors save the budget; the indie soul quietly leaves the room."),
      choice("Cut technical departments", ["locarno", "sundance"], ["venice", "oscars"],
        "Rough, handmade, defiantly lo-fi — the craft guilds are not amused."),
    ],
  },
  {
    id: "weather_shutdown",
    category: "Production",
    icon: "🌧",
    title: "Weather Shutdown",
    description: "A storm halts the production for ten days.",
    choices: [
      choice("Rewrite scenes indoors", ["venice", "cannes"], ["sundance", "berlin"],
        "Chamber drama by candlelight — intimate, but the world shrinks."),
      choice("Wait for natural light", ["locarno", "cannes"], ["oscars", "sundance"],
        "Purists wait for the perfect sky; the schedule bleeds."),
      choice("Relocate the production", ["oscars", "sundance"], ["venice", "berlin"],
        "A pragmatic pivot keeps it moving, at the cost of the original vision."),
    ],
  },
  {
    id: "studio_interference",
    category: "Production",
    icon: "🏢",
    title: "Studio Interference",
    description: "The studio demands commercial adjustments to the cut.",
    choices: [
      choice("Accept the changes", ["oscars", "sundance"], ["cannes", "venice"],
        "Crowd-friendly and clean — the auteurs feel betrayed."),
      choice("Resist completely", ["cannes", "venice"], ["oscars", "berlin"],
        "The vision is defended to the last frame; the studio goes cold."),
      choice("Negotiate a partial compromise", ["berlin", "oscars"], ["locarno", "cannes"],
        "A measured middle path that pleases nobody fully."),
    ],
  },
  {
    id: "missing_equipment",
    category: "Production",
    icon: "📦",
    title: "Missing Equipment",
    description: "The cameras arrive late and half the rig is missing.",
    choices: [
      choice("Use minimal equipment", ["locarno", "venice"], ["oscars", "sundance"],
        "Stripped-back and elemental — the gloss disappears."),
      choice("Delay production", ["cannes", "berlin"], ["oscars", "sundance"],
        "Wait for the right gear; the release window narrows."),
      choice("Rent commercial gear", ["oscars", "sundance"], ["locarno", "venice"],
        "Slick, modern, rented — and a little soulless."),
    ],
  },
  {
    id: "crew_strike",
    category: "Production",
    icon: "🪧",
    title: "Crew Strike",
    description: "The technical crew downs tools mid-shoot.",
    choices: [
      choice("Replace the crew quickly", ["oscars", "berlin"], ["cannes", "locarno"],
        "The machine keeps running; the artisans are gone."),
      choice("Negotiate with the union", ["venice", "cannes"], ["oscars", "sundance"],
        "Solidarity restored — and weeks lost to the table."),
      choice("Continue with a skeleton crew", ["locarno", "sundance"], ["berlin", "oscars"],
        "Guerrilla resourcefulness; the polish suffers."),
    ],
  },
  {
    id: "location_denied",
    category: "Production",
    icon: "🚧",
    title: "Location Denied",
    description: "Your filming permits are revoked at the last minute.",
    choices: [
      choice("Reconstruct the sets", ["venice", "oscars"], ["locarno", "berlin"],
        "A controlled, designed world — but the real edge is lost."),
      choice("Shoot guerrilla-style", ["locarno", "sundance"], ["oscars", "cannes"],
        "Raw, illicit, alive — and impossible to light properly."),
      choice("Change the script's location", ["berlin", "cannes"], ["venice", "oscars"],
        "Reinvention on the fly reshapes the whole story."),
    ],
  },
  {
    id: "postprod_rush",
    category: "Production",
    icon: "✂️",
    title: "Post-production Rush",
    description: "The editing deadline is suddenly moved up a month.",
    choices: [
      choice("Make a fast commercial cut", ["oscars", "sundance"], ["venice", "locarno"],
        "Punchy and propulsive; the slow beauty is trimmed away."),
      choice("Hold out for the director's cut", ["cannes", "venice"], ["oscars", "berlin"],
        "The full vision survives — and arrives fashionably late."),
      choice("Attempt an experimental edit", ["locarno", "berlin"], ["oscars", "sundance"],
        "A daring assembly that thrills some and baffles others."),
    ],
  },
  {
    id: "sound_problems",
    category: "Production",
    icon: "🎚",
    title: "Sound Problems",
    description: "The audio recordings come back inconsistent and patchy.",
    choices: [
      choice("Re-record all the dialogue", ["oscars", "venice"], ["cannes", "locarno"],
        "Pristine and legible — and a touch airless."),
      choice("Lean into ambient sound", ["locarno", "sundance"], ["oscars", "berlin"],
        "Documentary texture; the Academy mixers wince."),
      choice("Build a stylized sound design", ["cannes", "berlin"], ["oscars", "venice"],
        "Bold sonic authorship that overwhelms the script."),
    ],
  },

  // ── CATEGORY 2 — CAST ────────────────────────────────────────────────────
  {
    id: "star_demands_control",
    category: "Cast",
    icon: "🎬",
    title: "Star Demands Control",
    description: "Your lead actor wants approval over the final cut.",
    choices: [
      choice("Give them control", ["oscars", "sundance"], ["venice", "cannes"],
        "The star shines; the screenplay bends to ego."),
      choice("Refuse outright", ["venice", "cannes"], ["oscars", "berlin"],
        "Authorship protected — and one furious headliner."),
      choice("Reach a compromise", ["berlin", "oscars"], ["locarno", "sundance"],
        "Shared power, diluted edges."),
    ],
  },
  {
    id: "actor_improvises",
    category: "Cast",
    icon: "🗣",
    title: "Actor Improvises",
    description: "Your lead keeps abandoning the script for invented lines.",
    choices: [
      choice("Embrace the improvisation", ["locarno", "cannes"], ["oscars", "venice"],
        "Electric, unrepeatable spontaneity; the writers despair."),
      choice("Reshoot to the script", ["oscars", "venice"], ["locarno", "sundance"],
        "Disciplined and exact — and a little embalmed."),
      choice("Limit it to key scenes", ["berlin", "oscars"], ["cannes", "locarno"],
        "A managed looseness that satisfies neither camp."),
    ],
  },
  {
    id: "actress_refuses",
    category: "Cast",
    icon: "🚫",
    title: "Actress Refuses a Scene",
    description: "Your lead actress refuses to play a pivotal moment.",
    choices: [
      choice("Rewrite the scene", ["venice", "oscars"], ["cannes", "berlin"],
        "A graceful solution that softens the film's nerve."),
      choice("Replace the actress", ["oscars", "sundance"], ["venice", "locarno"],
        "The shoot survives; the chemistry resets to zero."),
      choice("Keep the tension on screen", ["cannes", "locarno"], ["oscars", "sundance"],
        "Raw friction bleeds into the frame — a risky charge."),
    ],
  },
  {
    id: "ensemble_conflict",
    category: "Cast",
    icon: "👥",
    title: "Ensemble Conflict",
    description: "The cast splinters into warring factions.",
    choices: [
      choice("Mediate between them", ["berlin", "venice"], ["oscars", "sundance"],
        "Hard-won harmony, at the cost of momentum."),
      choice("Take a side", ["oscars", "cannes"], ["locarno", "berlin"],
        "Decisive leadership that leaves casualties."),
      choice("Ignore it and shoot", ["locarno", "sundance"], ["venice", "oscars"],
        "Let the chaos feed the work — and fray the polish."),
    ],
  },
  {
    id: "method_breakdown",
    category: "Cast",
    icon: "🎭",
    title: "Method Acting Breakdown",
    description: "Your method actor unravels and cannot leave the role.",
    choices: [
      choice("Pause production", ["venice", "cannes"], ["oscars", "berlin"],
        "Care over the calendar; the schedule pays for it."),
      choice("Push through regardless", ["oscars", "sundance"], ["locarno", "venice"],
        "The performance is captured raw — ethics aside."),
      choice("Replace the actor", ["berlin", "oscars"], ["cannes", "locarno"],
        "A clean fix that loses the dangerous magic."),
    ],
  },
  {
    id: "casting_controversy",
    category: "Cast",
    icon: "📢",
    title: "Casting Controversy",
    description: "A casting choice ignites public outcry.",
    choices: [
      choice("Defend the choice", ["berlin", "cannes"], ["oscars", "sundance"],
        "A principled stand that the mainstream finds prickly."),
      choice("Replace the actor", ["oscars", "sundance"], ["venice", "locarno"],
        "The storm passes; so does the conviction."),
      choice("Keep the actor quietly", ["locarno", "venice"], ["oscars", "berlin"],
        "No statement, no retreat — and no political credit."),
    ],
  },
  {
    id: "actor_nominated",
    category: "Cast",
    icon: "🏅",
    title: "Actor Award Nomination",
    description: "A cast member lands a major nomination mid-shoot.",
    choices: [
      choice("Promote them heavily", ["oscars", "venice"], ["cannes", "locarno"],
        "A campaign machine roars to life around one face."),
      choice("Keep the focus on the film", ["cannes", "locarno"], ["oscars", "sundance"],
        "The work over the personality — and less buzz."),
      choice("Cancel the awards campaign", ["berlin", "sundance"], ["oscars", "venice"],
        "Anti-glamour purity that the industry reads as snubbing."),
    ],
  },
  {
    id: "star_absence",
    category: "Cast",
    icon: "🕳",
    title: "Star Absence",
    description: "Your star becomes suddenly, indefinitely unavailable.",
    choices: [
      choice("Recast the role", ["oscars", "sundance"], ["venice", "cannes"],
        "A familiar face plugged in; the original spell breaks."),
      choice("Adjust the script around them", ["venice", "berlin"], ["oscars", "locarno"],
        "Clever rewrites turn absence into theme."),
      choice("Film around the absence", ["locarno", "cannes"], ["oscars", "sundance"],
        "Negative space as style — a gamble on suggestion."),
    ],
  },

  // ── CATEGORY 3 — FESTIVAL POLITICS ──────────────────────────────────────
  {
    id: "jury_favoritism_leak",
    category: "Festival Politics",
    icon: "⚖️",
    title: "Jury Favoritism Leak",
    description: "A leak suggests the jury is already leaning a certain way.",
    choices: [
      choice("Exploit the leak", ["oscars", "cannes"], ["berlin", "venice"],
        "Play the angle hard; the high-minded recoil."),
      choice("Ignore it", ["venice", "berlin"], ["oscars", "sundance"],
        "Above the fray, and out of the conversation."),
      choice("Expose the leak", ["berlin", "sundance"], ["cannes", "oscars"],
        "A blow for transparency that burns bridges."),
    ],
  },
  {
    id: "political_pressure",
    category: "Festival Politics",
    icon: "🏛",
    title: "Political Pressure",
    description: "A government leans on the film's message.",
    choices: [
      choice("Align with them", ["berlin", "oscars"], ["cannes", "locarno"],
        "Official approval, artistic suspicion."),
      choice("Resist publicly", ["cannes", "venice"], ["berlin", "oscars"],
        "Defiance the cinephiles adore and the funders fear."),
      choice("Stay studiously neutral", ["locarno", "sundance"], ["berlin", "venice"],
        "Apolitical cool that reads as evasion to some."),
    ],
  },
  {
    id: "invitation_swap",
    category: "Festival Politics",
    icon: "🔁",
    title: "Festival Invitation Swap",
    description: "A rival festival wants to poach your premiere.",
    choices: [
      choice("Accept the minor festival", ["sundance", "locarno"], ["cannes", "venice"],
        "Indie loyalty over the red carpet."),
      choice("Refuse to protect the premiere", ["cannes", "venice"], ["sundance", "berlin"],
        "Exclusivity guarded jealously."),
      choice("Split the premiere", ["berlin", "oscars"], ["cannes", "locarno"],
        "Hedged bets that dilute the event."),
    ],
  },
  {
    id: "jury_president_bias",
    category: "Festival Politics",
    icon: "👑",
    title: "Jury President Bias",
    description: "The jury president has a famously specific taste.",
    choices: [
      choice("Use your influence", ["cannes", "oscars"], ["berlin", "venice"],
        "Whisper in the right ear; integrity takes the hit."),
      choice("Reject all lobbying", ["berlin", "sundance"], ["oscars", "cannes"],
        "Clean hands, colder reception."),
      choice("Network indirectly", ["venice", "locarno"], ["oscars", "sundance"],
        "Soft diplomacy that never quite closes."),
    ],
  },
  {
    id: "national_boycott",
    category: "Festival Politics",
    icon: "✊",
    title: "National Boycott",
    description: "Activists call for a boycott of your film.",
    choices: [
      choice("Take a public stance", ["berlin", "cannes"], ["oscars", "venice"],
        "Conviction on the world stage; markets close."),
      choice("Stay silent", ["oscars", "sundance"], ["berlin", "locarno"],
        "Commerce protected; courage questioned."),
      choice("Release a dual version", ["oscars", "venice"], ["berlin", "cannes"],
        "Two films for two crowds — and no clear soul."),
    ],
  },
  {
    id: "press_manipulation",
    category: "Festival Politics",
    icon: "📰",
    title: "Press Manipulation Offer",
    description: "A fixer offers to shape the festival narrative for you.",
    choices: [
      choice("Accept the offer", ["oscars", "sundance"], ["venice", "berlin"],
        "A favorable story, bought and paid for."),
      choice("Refuse on principle", ["cannes", "venice"], ["oscars", "sundance"],
        "Let the work speak; the silence is risky."),
      choice("Control the narrative yourself", ["berlin", "cannes"], ["locarno", "oscars"],
        "Author your own spin — and look like you're spinning."),
    ],
  },
  {
    id: "slot_change",
    category: "Festival Politics",
    icon: "🗓",
    title: "Festival Slot Change",
    description: "Your screening slot is reshuffled at the last minute.",
    choices: [
      choice("Accept an early slot", ["sundance", "berlin"], ["cannes", "venice"],
        "First out of the gate, easily forgotten by closing night."),
      choice("Demand a prime slot", ["cannes", "oscars"], ["sundance", "locarno"],
        "Top billing fought for and won — at a cost in goodwill."),
      choice("Withdraw the film", ["locarno", "venice"], ["oscars", "berlin"],
        "A purist's exit that reads as either bravery or sulking."),
    ],
  },
  {
    id: "jury_leak_scandal",
    category: "Festival Politics",
    icon: "🕵",
    title: "Jury Leak Scandal",
    description: "The jury's deliberations leak to the press.",
    choices: [
      choice("Demand an investigation", ["berlin", "venice"], ["oscars", "cannes"],
        "A call for order that irritates the establishment."),
      choice("Exploit the publicity", ["oscars", "sundance"], ["berlin", "locarno"],
        "Ride the scandal for column inches."),
      choice("Ignore it entirely", ["locarno", "cannes"], ["oscars", "venice"],
        "Serene detachment — or wilful blindness."),
    ],
  },

  // ── CATEGORY 4 — MEDIA & PUBLICITY ──────────────────────────────────────
  {
    id: "viral_misread",
    category: "Media",
    icon: "📱",
    title: "Viral Scene Misinterpretation",
    description: "A scene goes viral, wildly misread out of context.",
    choices: [
      choice("Clarify the meaning", ["venice", "oscars"], ["sundance", "cannes"],
        "A patient explanation that feels a touch defensive."),
      choice("Embrace the virality", ["oscars", "sundance"], ["venice", "berlin"],
        "Lean into the meme; the prestige set cringes."),
      choice("Stay silent", ["locarno", "berlin"], ["oscars", "sundance"],
        "Let it burn out — and let the moment pass."),
    ],
  },
  {
    id: "influencer_campaign",
    category: "Media",
    icon: "🤳",
    title: "Influencer Campaign",
    description: "A swarm of influencers offers to push the film.",
    choices: [
      choice("Accept the campaign", ["sundance", "oscars"], ["venice", "cannes"],
        "Reach explodes; the cinephiles roll their eyes."),
      choice("Reject it", ["cannes", "venice"], ["oscars", "sundance"],
        "Old-school prestige over algorithmic reach."),
      choice("Control the message", ["berlin", "oscars"], ["locarno", "venice"],
        "A curated rollout that pleases the middle, thrills no one."),
    ],
  },
  {
    id: "critics_divide",
    category: "Media",
    icon: "🗞",
    title: "Critics Divide",
    description: "Critics split violently over the film.",
    choices: [
      choice("Engage the critics", ["venice", "cannes"], ["oscars", "sundance"],
        "A high-culture debate that leaves the mainstream behind."),
      choice("Ignore the discourse", ["locarno", "sundance"], ["venice", "oscars"],
        "Indifference as a stance."),
      choice("Confront them head-on", ["berlin", "oscars"], ["cannes", "locarno"],
        "Pugnacious and loud — and a little crass."),
    ],
  },
  {
    id: "tabloid_scandal",
    category: "Media",
    icon: "📸",
    title: "Tabloid Scandal",
    description: "A tabloid runs a lurid story about your set.",
    choices: [
      choice("Address it publicly", ["oscars", "berlin"], ["venice", "cannes"],
        "A statesmanlike response; the art-house yawns."),
      choice("Deny everything", ["cannes", "locarno"], ["oscars", "sundance"],
        "Stonewall the press and dare them to prove it."),
      choice("Exploit the attention", ["sundance", "oscars"], ["berlin", "venice"],
        "Any press is press — dignity optional."),
    ],
  },
  {
    id: "buzz_collapse",
    category: "Media",
    icon: "📉",
    title: "Festival Buzz Collapse",
    description: "Early buzz suddenly evaporates.",
    choices: [
      choice("Rebuild the campaign", ["oscars", "sundance"], ["venice", "berlin"],
        "Throw money at the problem; the purists notice."),
      choice("Retreat into the art", ["cannes", "locarno"], ["oscars", "sundance"],
        "Let the film find its own slow audience."),
      choice("Order a radical re-edit", ["venice", "berlin"], ["cannes", "oscars"],
        "Reinvent in the dark — bold, destabilizing."),
    ],
  },
  {
    id: "ovation_leak",
    category: "Media",
    icon: "👏",
    title: "Standing Ovation Leak",
    description: "Footage of a rapturous ovation leaks early.",
    choices: [
      choice("Amplify it everywhere", ["oscars", "cannes"], ["berlin", "venice"],
        "Hype machine in overdrive; the serious set frowns."),
      choice("Downplay the moment", ["venice", "berlin"], ["oscars", "sundance"],
        "Modesty as positioning — and a missed wave."),
      choice("Reframe the narrative", ["locarno", "sundance"], ["cannes", "oscars"],
        "Spin it indie; the mainstream tunes out."),
    ],
  },
  {
    id: "meme_explosion",
    category: "Media",
    icon: "😂",
    title: "Meme Culture Explosion",
    description: "The film becomes an internet meme overnight.",
    choices: [
      choice("Embrace the meme", ["sundance", "oscars"], ["venice", "cannes"],
        "Ride the wave to the masses; lose the gravitas."),
      choice("Fight the meme", ["venice", "berlin"], ["oscars", "sundance"],
        "Defend the film's dignity — and look humorless."),
      choice("Ignore it completely", ["locarno", "cannes"], ["oscars", "berlin"],
        "Refuse to play; the moment passes you by."),
    ],
  },
  {
    id: "critic_boycott",
    category: "Media",
    icon: "🚷",
    title: "Critic Boycott",
    description: "A critics' guild boycotts your screening.",
    choices: [
      choice("Respond firmly", ["berlin", "venice"], ["oscars", "cannes"],
        "Hold the line; the establishment bristles."),
      choice("Invite dialogue", ["cannes", "oscars"], ["berlin", "sundance"],
        "Open arms that some read as capitulation."),
      choice("Ignore the boycott", ["locarno", "sundance"], ["venice", "oscars"],
        "Carry on regardless — and forgo the debate."),
    ],
  },

  // ── CATEGORY 5 — ARTISTIC INTEGRITY ─────────────────────────────────────
  {
    id: "controversial_ending",
    category: "Artistic Integrity",
    icon: "🎬",
    title: "Controversial Ending",
    description: "Your ending divides every test audience.",
    choices: [
      choice("Keep the ending", ["cannes", "berlin"], ["oscars", "sundance"],
        "Uncompromising — and commercially fearless."),
      choice("Change the ending", ["oscars", "venice"], ["locarno", "cannes"],
        "Resolution restored; the danger drains out."),
      choice("Release split versions", ["sundance", "oscars"], ["berlin", "venice"],
        "Two endings, half a conviction each."),
    ],
  },
  {
    id: "experimental_soundtrack",
    category: "Artistic Integrity",
    icon: "🎼",
    title: "Experimental Soundtrack",
    description: "Your composer delivers something radically abstract.",
    choices: [
      choice("Keep the score", ["locarno", "cannes"], ["oscars", "sundance"],
        "Difficult, glorious sound; the Academy is baffled."),
      choice("Replace it", ["oscars", "venice"], ["locarno", "berlin"],
        "Safe, sweeping, expected."),
      choice("Build a hybrid", ["berlin", "sundance"], ["cannes", "oscars"],
        "Half-tamed strangeness that fully satisfies no one."),
    ],
  },
  {
    id: "nonpro_casting",
    category: "Artistic Integrity",
    icon: "👤",
    title: "Non-professional Casting",
    description: "You've cast untrained unknowns in key roles.",
    choices: [
      choice("Keep the non-actors", ["locarno", "berlin"], ["oscars", "cannes"],
        "Bracing authenticity; technique be damned."),
      choice("Replace them with pros", ["oscars", "venice"], ["sundance", "locarno"],
        "Polished performances, manufactured truth."),
      choice("Mix professionals and amateurs", ["sundance", "cannes"], ["berlin", "oscars"],
        "A textured blend that muddies the statement."),
    ],
  },
  {
    id: "directors_cut",
    category: "Artistic Integrity",
    icon: "🎞",
    title: "Director's Cut Demand",
    description: "Your director demands the final cut, no notes.",
    choices: [
      choice("Grant the final cut", ["cannes", "venice"], ["oscars", "sundance"],
        "Pure authorship; the market loses its grip."),
      choice("Refuse the demand", ["oscars", "berlin"], ["cannes", "locarno"],
        "Control retained; the auteur seethes."),
      choice("Allow a partial cut", ["sundance", "oscars"], ["venice", "berlin"],
        "Shared scissors, blunted vision."),
    ],
  },
  {
    id: "improv_style",
    category: "Artistic Integrity",
    icon: "💬",
    title: "Improvised Dialogue Style",
    description: "The film leans entirely on improvised dialogue.",
    choices: [
      choice("Go fully improvised", ["locarno", "sundance"], ["oscars", "venice"],
        "Loose, living, unrepeatable — and structurally wild."),
      choice("Impose script control", ["oscars", "venice"], ["locarno", "berlin"],
        "Tightened and precise; the spark dims."),
      choice("Build a hybrid method", ["cannes", "berlin"], ["oscars", "sundance"],
        "Structured spontaneity that hedges its bets."),
    ],
  },
  {
    id: "long_runtime",
    category: "Artistic Integrity",
    icon: "⏳",
    title: "Long Runtime Problem",
    description: "The film clocks in at three and a half hours.",
    choices: [
      choice("Cut it down", ["oscars", "sundance"], ["venice", "locarno"],
        "Trim, trim, trim — the epic shrinks to a feature."),
      choice("Keep the full length", ["cannes", "venice"], ["oscars", "berlin"],
        "An immersive marathon; exhibitors groan."),
      choice("Split it into parts", ["berlin", "locarno"], ["oscars", "sundance"],
        "A two-film gamble that tests everyone's patience."),
    ],
  },
  {
    id: "political_allegory",
    category: "Artistic Integrity",
    icon: "🗳",
    title: "Political Allegory Dispute",
    description: "Critics read a political allegory you never confirmed.",
    choices: [
      choice("Embrace the meaning", ["berlin", "cannes"], ["oscars", "venice"],
        "Claim the politics; the mainstream gets nervous."),
      choice("Deny any intention", ["oscars", "sundance"], ["berlin", "locarno"],
        "Pure entertainment, no agenda — and no edge."),
      choice("Stay ambiguous", ["locarno", "venice"], ["oscars", "berlin"],
        "Refuse to settle it — tantalizing or evasive."),
    ],
  },
  {
    id: "final_cut_battle",
    category: "Artistic Integrity",
    icon: "⚔️",
    title: "Final Cut Ownership Battle",
    description: "Director and studio go to war over the final cut.",
    choices: [
      choice("The director wins", ["cannes", "locarno"], ["oscars", "sundance"],
        "Vision triumphant; the box office trembles."),
      choice("The studio wins", ["oscars", "sundance"], ["venice", "berlin"],
        "Commercial order restored, soul negotiable."),
      choice("Shared control", ["berlin", "venice"], ["cannes", "oscars"],
        "An uneasy truce that satisfies no purist."),
    ],
  },
];
