/**
 * Self-improvement memory: every time the creator flags a defect on a result,
 * we store a corrective hard-rule. Those rules are injected into every later
 * generation, so the generator measurably improves per creator over time.
 */

const KEY = "rogen.learned.v1";
const MAX = 14;

export type LearnedRule = { id: string; rule: string; hits: number; at: number };

export type IssueId =
  | "sleeves"
  | "wrists"
  | "legs"
  | "background"
  | "checker"
  | "flat"
  | "mirror"
  | "reference"
  | "seams";

export const ISSUES: { id: IssueId; label: string; rule: string }[] = [
  {
    id: "sleeves",
    label: "Mangas bugadas",
    rule: "Sleeve panels were broken last time: repaint all four long arm faces with the cuff and shoulder rows at the exact same pixel height, one clean horizontal hem, no diagonal or offset cuts.",
  },
  {
    id: "wrists",
    label: "Punho / buraco da mão",
    rule: "The wrist/hand opening (ARM BOTTOM face) was wrong last time: paint it only as the inner-cuff fabric tone ringed by the cuff color — never skin, hands, gloves or garment art — and key it out entirely for short sleeves.",
  },
  {
    id: "legs",
    label: "Partes da calça erradas",
    rule: "Leg panels were wrong last time: waistband on the TOP row of all four long faces at identical height, hem/cuff on the BOTTOM row at identical height, foot opening painted as inner fabric only, upper torso group fully keyed out.",
  },
  {
    id: "background",
    label: "Fundo não ficou transparente",
    rule: "The background was not transparent last time: every non-garment pixel must be flat pure #FF00FF chroma, absolutely no white, gray, beige or gradient anywhere outside the garment panels.",
  },
  {
    id: "checker",
    label: "Xadrez falso de transparência",
    rule: "A fake checkerboard was painted last time to imitate transparency. Never paint a checkerboard or any transparency-looking pattern — transparent means flat #FF00FF and nothing else.",
  },
  {
    id: "flat",
    label: "Tecido liso / artificial",
    rule: "The fabric read as a flat artificial fill last time: every panel needs visible weave, painted grain, stitching and at least three tonal steps per color region.",
  },
  {
    id: "mirror",
    label: "Espelhamento errado",
    rule: "Mirroring was wrong last time: side stripes, pockets and piping must sit on the OUTER side of both limbs, correctly mirrored, never duplicated on the inner side.",
  },
  {
    id: "reference",
    label: "Não seguiu a referência",
    rule: "Reference fidelity was poor last time: match the reference's exact color palette, material signature, pattern scale and construction details before adding anything of your own.",
  },
  {
    id: "seams",
    label: "Costuras não batem",
    rule: "Seams broke last time: adjacent cell edges of the same body part must match pixel-for-pixel in color, pattern phase and stitching so the wrap is seamless.",
  },
];

export function loadLearned(): LearnedRule[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LearnedRule[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(rules: LearnedRule[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rules.slice(-MAX)));
  } catch {
    /* ignore */
  }
}

export function recordIssues(ids: IssueId[]): LearnedRule[] {
  const current = loadLearned();
  const byId = new Map(current.map((r) => [r.id, r]));
  for (const id of ids) {
    const issue = ISSUES.find((i) => i.id === id);
    if (!issue) continue;
    const existing = byId.get(id);
    if (existing) {
      existing.hits += 1;
      existing.at = Date.now();
    } else {
      byId.set(id, { id, rule: issue.rule, hits: 1, at: Date.now() });
    }
  }
  // Most-repeated defects first — those matter most.
  const next = [...byId.values()].sort((a, b) => b.hits - a.hits || b.at - a.at);
  save(next);
  return next;
}

export function clearLearned() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function learnedRuleStrings(rules: LearnedRule[]): string[] {
  return rules.map((r) =>
    r.hits > 1 ? `${r.rule} (repeated defect, seen ${r.hits}x — highest priority)` : r.rule,
  );
}
