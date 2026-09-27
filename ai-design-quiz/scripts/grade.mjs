import { configFrom, gradeBatch } from '../src/grader-client.js';
const watch = process.argv.includes('--watch');
let running = true;
process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });
try {
  const config = configFrom(process.env);
  do {
    const result = await gradeBatch(config, { limit: 10 });
    console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
    if (watch && running) await new Promise(resolve => setTimeout(resolve, Math.max(5, Number(process.env.GRADING_POLL_SECONDS) || 15) * 1000));
  } while (watch && running);
} catch (error) {
  console.error('採点を実行できませんでした:', error.reason || 'grader_error');
  if (error.reason === 'missing_config') console.error('QUIZ_API_URL, GRADING_API_KEY, OPENAI_API_KEY を設定してください。');
  process.exitCode = 1;
}
