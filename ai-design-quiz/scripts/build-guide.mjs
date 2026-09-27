import { readFile, writeFile } from 'node:fs/promises';
import { marked } from 'marked';
const root = new URL('../', import.meta.url);
const markdown = await readFile(new URL('../README.ja.md', root), 'utf8');
const escape = text => text.replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const renderer = new marked.Renderer();
renderer.heading = function ({ tokens, depth }) {
  const text = this.parser.parseInline(tokens);
  const slug = tokens.map(t => t.text || '').join('').toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/g, '-');
  return `<h${depth} id="${escape(slug)}">${text}</h${depth}>\n`;
};
// Only the repository's trusted Markdown is rendered; no answers or user input.
const content = marked.parse(markdown, { renderer }).replace('href="ai-design-quiz/README.md"', 'href="https://github.com/kzmszk/ai-system-design/blob/main/ai-design-quiz/README.md"');
await writeFile(new URL('public/guide.html', root), `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AIシステム設計 — 日本語ガイド</title>
<style>html{scroll-padding-top:24px}body{margin:0;background:#f4f5f9;color:#202b3d;font-family:system-ui,sans-serif;line-height:1.9}main{max-width:860px;margin:32px auto;padding:32px;background:white;border:1px solid #dce3ed;border-radius:16px}nav{display:flex;gap:20px;flex-wrap:wrap}a{color:#3157a7;overflow-wrap:anywhere}h1,h2,h3{line-height:1.5}h2{margin-top:2.5em;border-bottom:1px solid #dce3ed;padding-bottom:.4em}table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}td,th{padding:8px;border:1px solid #dce3ed}blockquote{margin-left:0;border-left:3px solid #91a8da;padding-left:16px;color:#526078}pre{overflow:auto}img{max-width:100%}@media(max-width:640px){main{margin:0;padding:20px;border:0;border-radius:0}}</style></head>
<body><main><nav><a href="/">← クイズへ戻る</a><a href="/README.ja.md">Markdown版</a></nav>${content}<footer><a href="/LICENSE.txt">Apache License 2.0</a> · <a href="/NOTICE.txt">原典・著作権表示</a></footer></main></body></html>\n`);
await writeFile(new URL('public/README.ja.md', root), markdown);
console.log('Generated public/guide.html and public/README.ja.md from README.ja.md');
