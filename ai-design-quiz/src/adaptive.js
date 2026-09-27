import { bank, domains } from './questions.js';
export { domains };
export const SCREENING = 8;
export const MIN = 12;
export const MAX = 16;
export const BANK_VERSION = '2026-09-26.2';
const grid = Array.from({ length: 25 }, (_, i) => -2.5 + i * .25);
const difficulty = { 1: -.8, 2: .4, 3: 1.6 };
const normalize = values => { const total = values.reduce((a, b) => a + b, 0); return values.map(v => v / total); };
const prior = () => normalize(grid.map(t => Math.exp(-.5 * ((t - .35) / 1.25) ** 2)));
const probability = (q, t) => { const p = 1 / (1 + Math.exp(-1.5 * (t - difficulty[q.level]))); return q.type === 'choice' ? .25 + .75 * p : p; };
const entropy = p => -p.reduce((sum, v) => sum + v * Math.log(v || 1), 0);
function update(p, q, score) { return normalize(p.map((v, i) => { const x = probability(q, grid[i]); return v * Math.pow(x ** score * (1 - x) ** (1 - score), q.type === 'written' ? .8 : 1); })); }
function information(p, q) { const yes = p.reduce((sum, v, i) => sum + v * probability(q, grid[i]), 0); return entropy(p) - yes * entropy(update(p, q, 1)) - (1 - yes) * entropy(update(p, q, 0)); }
export function unpack(rows) { return rows.map(r => ({ ...r, question: JSON.parse(r.question_json), answer: JSON.parse(r.answer_json) })); }
export function domainStats(rows) {
  return domains.map(d => {
    const answered = rows.filter(r => r.question.domain === d.id), scored = answered.filter(r => r.score !== null), pending = answered.filter(r => r.status === 'pending').length;
    let p = prior(); for (const r of scored) p = update(p, r.question, r.score);
    const mean = scored.length ? scored.reduce((sum, r) => sum + r.score, 0) / scored.length : null;
    const theta = p.reduce((sum, v, i) => sum + v * grid[i], 0);
    const low = scored.filter(r => r.score < .6).length;
    const status = !answered.length ? 'unseen' : !scored.length ? 'pending' : mean < .6 ? (low >= 2 ? 'review' : 'candidate') : scored.length >= 2 && mean >= .75 ? 'evidence' : 'uncertain';
    return { ...d, count: answered.length, scoredCount: scored.length, pending, needsReview: answered.filter(r => r.status === 'needs_review').length, mean, theta, status, posterior: p };
  });
}
function frozenQuestion(q, seed, ordinal) {
  const copy = { ...q, bankVersion: BANK_VERSION };
  if (q.type === 'choice') {
    const options = q.options.map((label, index) => ({ label, index }));
    let x = (seed + ordinal * 31 + [...q.id].reduce((n, c) => n + c.charCodeAt(0), 0)) >>> 0;
    for (let i = options.length - 1; i > 0; i--) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; const j = x % (i + 1); [options[i], options[j]] = [options[j], options[i]]; }
    copy.options = options.map(o => o.label); copy.correct = options.findIndex(o => o.index === q.correct);
  }
  return copy;
}
export function eligibleBank(settings = {}) {
  return bank.filter(q => (!settings.domains || settings.domains.includes(q.domain)) && (!settings.level || q.level === settings.level));
}
export function screeningSize(excluded = new Set(), settings = {}) {
  return new Set(eligibleBank(settings).filter(q => q.type === 'choice' && !excluded.has(q.id)).map(q => q.domain)).size;
}
export function decide(rows, seed, excluded = new Set(), settings = {}) {
  const screening = screeningSize(excluded, settings);
  const count = rows.length, stats = domainStats(rows).filter(d => !settings.domains || settings.domains.includes(d.id)), pending = rows.some(r => r.status === 'pending');
  if (count >= MIN && pending) return { status: 'awaiting_grading', question: null, reason: '記述回答の採点を待ってから、追加問題が必要か判断します。' };
  if (count >= MAX) return { status: 'completed', question: null, reason: '16問まで確認しました。未確認のテーマを残した暫定診断です。' };
  if (count >= MIN) {
    const weak = stats.filter(d => d.mean !== null && d.mean < .6);
    const unknown = stats.some(d => !d.scoredCount || d.needsReview);
    if (!unknown && (!weak.length || weak.length >= 6 || (weak.length <= 2 && weak.every(d => d.scoredCount >= 2)))) {
      return { status: 'completed', question: null, reason: '選択問題と絞り込み問題で復習の方向が見えたため、出題を短縮しました。' };
    }
  }
  const used = new Set(rows.map(r => r.question_id));
  let candidates = eligibleBank(settings).filter(q => !used.has(q.id) && !excluded.has(q.id) && stats.find(d => d.id === q.domain).count < 3), q;
  if (count < screening) {
    const d = stats.find(d => !d.count && candidates.some(q => q.domain === d.id && q.type === 'choice')), recent = rows.slice(-3).filter(r => r.score !== null);
    const mean = recent.length ? recent.reduce((s, r) => s + r.score, 0) / recent.length : .5;
    const level = recent.length < 2 ? 2 : mean >= .85 ? 3 : mean <= .35 ? 1 : 2;
    candidates = candidates.filter(q => q.domain === d?.id && q.type === 'choice');
    const distance = Math.min(...candidates.map(q => Math.abs(q.level - level)));
    candidates = candidates.filter(q => Math.abs(q.level - level) === distance);
    q = candidates[(seed + count) % candidates.length];
  } else {
    // First two written tasks are only issued after all eight choice-only domains.
    const type = [screening, screening + 2].includes(count) ? 'written' : 'choice';
    const preferred = candidates.filter(q => q.type === type);
    if (preferred.length) candidates = preferred;
    const writtenDomains = new Set(rows.filter(r => r.kind === 'written').map(r => r.question.domain));
    const ranked = candidates.map(q => {
      const d = stats.find(d => d.id === q.domain);
      const priority = 1 + (d.mean !== null && d.mean < .6 ? .75 : 0) + (d.count === 1 ? .25 : 0);
      const diversity = type === 'written' && writtenDomains.has(q.domain) ? .1 : 1;
      const pendingPenalty = d.pending ? .35 : 1;
      return { q, value: information(d.posterior, q) * priority * diversity * pendingPenalty };
    }).sort((a, b) => b.value - a.value || a.q.id.localeCompare(b.q.id));
    q = ranked[0]?.q;
  }
  if (!q) return pending
    ? { status: 'awaiting_grading', question: null, reason: '出題可能な問題を回答しました。記述回答の採点を待っています。' }
    : { status: 'completed', question: null, reason: count === 0 ? '選んだ条件の問題はすべて過去に正解済みです。カテゴリやレベルを変更してください。過去の診断から解説を復習できます。' : '過去に正解した問題を除き、今回出題できる問題を確認しました。問題数が少ない分野は今回の回答だけでは判断できません。' };
  return { status: 'active', question: frozenQuestion(q, seed, count), reason: count < screening ? '過去の正解を除いた選択問題で、レベルを確認しています。' : 'ここまでの回答から、弱点候補や追加の証拠が必要な分野を確認します。' };
}
export function publicQuestion(q) { if (!q) return null; const { id, domain, level, type, prompt, options } = q; return { id, domain, level, type, prompt, ...(options ? { options } : {}) }; }
