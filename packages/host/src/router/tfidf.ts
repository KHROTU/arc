export interface DifficultyFold {
  coef: number[];
  intercept: number;
  sigmoidA: number;
  sigmoidB: number;
}
export interface DifficultyModel {
  vocab: Record<string, number>;
  idf: number[];
  folds: DifficultyFold[];
  weakScore: number;
  strongScore: number;
}
export function loadDifficultyModel(json: DifficultyModel): DifficultyModel {
  return json;
}
const TOKEN_RE = /\b\w\w+\b/g;
export function tokenize(text: string): string[] {
  const t = text.toLowerCase();
  return t.match(TOKEN_RE) ?? [];
}
function ngrams(tokens: string[]): string[] {
  const out: string[] = tokens.slice();
  for (let i = 0; i < tokens.length - 1; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}
export function transformDocument(text: string, model: DifficultyModel): number[] {
  const tokens = tokenize(text);
  const counts = new Map<number, number>();
  for (const g of ngrams(tokens)) {
    const j = model.vocab[g];
    if (j !== undefined) counts.set(j, (counts.get(j) ?? 0) + 1);
  }
  const n = model.idf.length;
  const raw = new Float64Array(n);
  for (const [j, c] of counts) {
    const tf = 1.0 + Math.log(c); 
    raw[j] = tf * model.idf[j];
  }
  let norm = 0;
  for (let i = 0; i < n; i++) norm += raw[i] * raw[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = raw[i] / norm;
  return Array.from(out);
}
export function estimateDifficulty(text: string, model: DifficultyModel): number {
  const x = transformDocument(text, model);
  let sum = 0;
  for (const f of model.folds) {
    let dec = f.intercept;
    for (let i = 0; i < x.length; i++) dec += f.coef[i] * x[i];
    sum += 1.0 / (1.0 + Math.exp(f.sigmoidA * dec + f.sigmoidB));
  }
  return sum / model.folds.length;
}