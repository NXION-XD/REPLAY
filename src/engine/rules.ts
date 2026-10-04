// ============================================================================
// Strategy rule engine. Users compose condition trees over a feature registry.
// Every feature is evaluated causally at the current replay candle.
// Verdict: ACCEPTED (all required pass), REJECTED (a required rule fails),
// WARNING (required pass, warning-severity rules fail). NEVER forced trades.
// ============================================================================

export type Comparator = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'is_true' | 'is_false';

export interface LeafCondition {
  kind: 'leaf';
  feature: string;
  comparator: Comparator;
  value?: string | number | string[];
  severity: 'required' | 'warning';
  label?: string;
}

export interface GroupCondition {
  kind: 'group';
  op: 'and' | 'or' | 'not';
  children: Condition[];
}

export type Condition = LeafCondition | GroupCondition;

export interface StrategyProfile {
  id: string;
  name: string;
  tree: Condition;
  /** thresholds for quality grade: [A_min, B_min] as fraction 0..1 */
  gradeA: number;
  gradeB: number;
  createdAt: number;
}

export interface RuleResult {
  path: string;
  label: string;
  severity: 'required' | 'warning';
  status: 'PASS' | 'FAIL' | 'N/A';
  actual?: string | number | boolean;
}

export interface RuleVerdict {
  verdict: 'ACCEPTED' | 'REJECTED' | 'WARNING';
  results: RuleResult[];
  passed: number;
  total: number;
  score: number; // fraction of non-NA leaves passed
  grade: 'A' | 'B' | 'C';
}

// ---------------------------------------------------------------------------
// Feature registry — what the user can write rules about.
// ---------------------------------------------------------------------------

export interface RuleContext {
  session: string; // session id or 'none'
  minutesIntoSession: number;
  hour: number;
  minute: number;
  dayOfWeek: number; // 0-6
  htfBias: 'bullish' | 'bearish' | 'neutral';
  htfBiasSecondary: 'bullish' | 'bearish' | 'neutral';
  sweptAsiaHigh: boolean;
  sweptAsiaLow: boolean;
  sweptPrevDayHigh: boolean;
  sweptPrevDayLow: boolean;
  mssUp: boolean;
  mssDown: boolean;
  bosUp: boolean;
  bosDown: boolean;
  fvgBullish: boolean;
  fvgBearish: boolean;
  insideFvg: boolean;
  trend: 'bullish' | 'bearish' | 'neutral';
  rangeState: 'trending' | 'ranging' | 'transition';
  volatility: 'low' | 'normal' | 'high' | 'extreme';
  atr: number;
  atrPercentile: number;
  rr: number; // prospective R:R of the trade being considered
  slDistancePoints: number;
  priceAboveFastEma: boolean;
  priceAboveSlowEma: boolean;
  spreadPoints: number;
}

export type FeatureType = 'string' | 'number' | 'boolean' | 'enum';

export interface FeatureDef {
  id: keyof RuleContext & string;
  label: string;
  type: FeatureType;
  options?: string[]; // for enum
  defaultComparator: Comparator;
}

export const FEATURES: FeatureDef[] = [
  { id: 'session', label: 'Session', type: 'enum', options: ['asia', 'london', 'newyork', 'none'], defaultComparator: 'eq' },
  { id: 'minutesIntoSession', label: 'Minutes into session', type: 'number', defaultComparator: 'gte' },
  { id: 'hour', label: 'Hour of day', type: 'number', defaultComparator: 'eq' },
  { id: 'minute', label: 'Minute', type: 'number', defaultComparator: 'eq' },
  { id: 'dayOfWeek', label: 'Day of week (0=Sun)', type: 'number', defaultComparator: 'eq' },
  { id: 'htfBias', label: 'HTF bias', type: 'enum', options: ['bullish', 'bearish', 'neutral'], defaultComparator: 'eq' },
  { id: 'htfBiasSecondary', label: 'HTF bias (secondary)', type: 'enum', options: ['bullish', 'bearish', 'neutral'], defaultComparator: 'eq' },
  { id: 'sweptAsiaHigh', label: 'Asia High swept (recent)', type: 'boolean', defaultComparator: 'is_true' },
  { id: 'sweptAsiaLow', label: 'Asia Low swept (recent)', type: 'boolean', defaultComparator: 'is_true' },
  { id: 'sweptPrevDayHigh', label: 'Prev Day High swept', type: 'boolean', defaultComparator: 'is_true' },
  { id: 'sweptPrevDayLow', label: 'Prev Day Low swept', type: 'boolean', defaultComparator: 'is_true' },
  { id: 'mssUp', label: 'MSS/CHOCH up (recent)', type: 'boolean', defaultComparator: 'is_true' },
  { id: 'mssDown', label: 'MSS/CHOCH down (recent)', type: 'boolean', defaultComparator: 'is_true' },
  { id: 'bosUp', label: 'BOS up (recent)', type: 'boolean', defaultComparator: 'is_true' },
  { id: 'bosDown', label: 'BOS down (recent)', type: 'boolean', defaultComparator: 'is_true' },
  { id: 'fvgBullish', label: 'Unfilled bullish FVG nearby', type: 'boolean', defaultComparator: 'is_true' },
  { id: 'fvgBearish', label: 'Unfilled bearish FVG nearby', type: 'boolean', defaultComparator: 'is_true' },
  { id: 'insideFvg', label: 'Price inside FVG', type: 'boolean', defaultComparator: 'is_true' },
  { id: 'trend', label: 'Trend (EMA)', type: 'enum', options: ['bullish', 'bearish', 'neutral'], defaultComparator: 'eq' },
  { id: 'rangeState', label: 'Trend/Range state', type: 'enum', options: ['trending', 'ranging', 'transition'], defaultComparator: 'eq' },
  { id: 'volatility', label: 'Volatility regime', type: 'enum', options: ['low', 'normal', 'high', 'extreme'], defaultComparator: 'eq' },
  { id: 'atr', label: 'ATR', type: 'number', defaultComparator: 'gte' },
  { id: 'atrPercentile', label: 'ATR percentile (0-1)', type: 'number', defaultComparator: 'gte' },
  { id: 'rr', label: 'Prospective R:R', type: 'number', defaultComparator: 'gte' },
  { id: 'slDistancePoints', label: 'SL distance (points)', type: 'number', defaultComparator: 'lte' },
  { id: 'priceAboveFastEma', label: 'Price above fast EMA', type: 'boolean', defaultComparator: 'is_true' },
  { id: 'priceAboveSlowEma', label: 'Price above slow EMA', type: 'boolean', defaultComparator: 'is_true' },
  { id: 'spreadPoints', label: 'Spread (points)', type: 'number', defaultComparator: 'lte' },
];

// ---------------------------------------------------------------------------

function compare(actual: unknown, cmp: Comparator, value?: string | number | string[]): boolean {
  switch (cmp) {
    case 'eq': return String(actual) === String(value);
    case 'neq': return String(actual) !== String(value);
    case 'gt': return Number(actual) > Number(value);
    case 'lt': return Number(actual) < Number(value);
    case 'gte': return Number(actual) >= Number(value);
    case 'lte': return Number(actual) <= Number(value);
    case 'in': return Array.isArray(value) ? value.map(String).includes(String(actual)) : String(actual) === String(value);
    case 'is_true': return actual === true;
    case 'is_false': return actual === false;
  }
}

export function evaluateStrategy(
  tree: Condition, ctx: RuleContext | null, gradeA = 0.8, gradeB = 0.6
): RuleVerdict {
  const results: RuleResult[] = [];
  let counter = 0;

  // `inverted` propagates De Morgan-style through NOT groups so checklist
  // statuses reflect the effective outcome of each condition.
  const walk = (node: Condition, path: string, inverted: boolean): boolean | null => {
    if (node.kind === 'leaf') {
      const f = FEATURES.find((x) => x.id === node.feature);
      const label = node.label ?? (inverted ? 'NOT ' + (f?.label ?? node.feature) : f?.label ?? node.feature);
      if (ctx === null) {
        results.push({ path, label, severity: node.severity, status: 'N/A' });
        return null;
      }
      const actual = ctx[node.feature as keyof RuleContext];
      if (actual === undefined || (typeof actual === 'number' && isNaN(actual))) {
        results.push({ path, label, severity: node.severity, status: 'N/A' });
        return null;
      }
      let pass = compare(actual, node.comparator, node.value);
      if (inverted) pass = !pass;
      results.push({ path, label, severity: node.severity, status: pass ? 'PASS' : 'FAIL', actual: actual as string | number | boolean });
      return pass;
    }
    if (node.op === 'not') {
      const v = node.children[0] ? walk(node.children[0], path + '.0', !inverted) : null;
      return v === null ? null : !v;
    }
    const vals = node.children.map((c, i) => walk(c, `${path}.${i}`, inverted));
    if (node.op === 'and') {
      if (vals.includes(false)) return false;
      if (vals.includes(null)) return null;
      return true;
    }
    // or
    if (vals.includes(true)) return true;
    if (vals.every((v) => v === null)) return null;
    return false;
  };

  walk(tree, String(counter++), false); // populates flat display results

  // Severity-aware tree evaluation: in OR groups a failing branch does not
  // matter if another branch passes — so the verdict is derived from the
  // tree structure, not from flat leaf statuses.
  const evalTree = (node: Condition, inverted: boolean): { v: boolean | null; sev: 'required' | 'warning' | null } => {
    if (node.kind === 'leaf') {
      if (ctx === null) return { v: null, sev: null };
      const actual = ctx[node.feature as keyof RuleContext];
      if (actual === undefined || (typeof actual === 'number' && isNaN(actual))) return { v: null, sev: null };
      let pass = compare(actual, node.comparator, node.value);
      if (inverted) pass = !pass;
      return { v: pass, sev: pass ? null : node.severity };
    }
    if (node.op === 'not') return evalTree(node.children[0] ?? { kind: 'group', op: 'and', children: [] }, !inverted);
    const cs = node.children.map((c) => evalTree(c, inverted));
    if (node.op === 'and') {
      const fails = cs.filter((c) => c.v === false);
      if (fails.length > 0) return { v: false, sev: fails.some((f) => f.sev === 'required') ? 'required' : 'warning' };
      if (cs.some((c) => c.v === null)) return { v: null, sev: null };
      return { v: true, sev: null };
    }
    if (cs.some((c) => c.v === true)) return { v: true, sev: null };
    if (cs.every((c) => c.v === null)) return { v: null, sev: null };
    return { v: false, sev: cs.some((c) => c.sev === 'required') ? 'required' : 'warning' };
  };
  const treeEval = evalTree(tree, false);

  const applicable = results.filter((r) => r.status !== 'N/A');
  const passed = applicable.filter((r) => r.status === 'PASS').length;
  const score = applicable.length > 0 ? passed / applicable.length : 0;

  let verdict: RuleVerdict['verdict'];
  if (treeEval.v === false && treeEval.sev === 'required') verdict = 'REJECTED';
  else if (treeEval.v === false || treeEval.v === null) verdict = 'WARNING';
  else verdict = 'ACCEPTED';

  const grade: RuleVerdict['grade'] = score >= gradeA ? 'A' : score >= gradeB ? 'B' : 'C';

  return { verdict, results, passed, total: results.length, score, grade };
}

// ---------------------------------------------------------------------------

export const emptyTree = (): Condition => ({ kind: 'group', op: 'and', children: [] });

export const makeLeaf = (feature: string): LeafCondition => {
  const f = FEATURES.find((x) => x.id === feature);
  return {
    kind: 'leaf',
    feature,
    comparator: f?.defaultComparator ?? 'eq',
    value: f?.type === 'enum' ? f.options?.[0] : f?.type === 'number' ? 0 : undefined,
    severity: 'required',
  };
};

/** Example starter profile: London sweep reversal */
export const LONDON_SWEEP_TEMPLATE = (): StrategyProfile => ({
  id: 'tpl-london-sweep',
  name: 'London Sweep (template)',
  tree: {
    kind: 'group', op: 'and', children: [
      { kind: 'leaf', feature: 'session', comparator: 'eq', value: 'london', severity: 'required' },
      { kind: 'leaf', feature: 'sweptAsiaHigh', comparator: 'is_true', severity: 'required' },
      { kind: 'leaf', feature: 'mssDown', comparator: 'is_true', severity: 'required' },
      { kind: 'leaf', feature: 'fvgBearish', comparator: 'is_true', severity: 'warning' },
      { kind: 'leaf', feature: 'rr', comparator: 'gte', value: 2, severity: 'required' },
      { kind: 'leaf', feature: 'htfBias', comparator: 'in', value: ['bearish', 'neutral'], severity: 'warning' },
    ],
  },
  gradeA: 0.85, gradeB: 0.65, createdAt: Date.now(),
});
