import { validateGrade } from './grading.js';
import { hash, now } from './http.js';

// The outbox belongs to the quiz. It is committed atomically with the answer.
export function enqueueQuiz(env, answerId, question, answer, time) {
  const payload={question:question.prompt,modelAnswer:question.model,rubric:question.rubric,answer};
  return env.DB.prepare("INSERT INTO quiz_job_outbox(answer_id,payload_json,created_at) SELECT id,?,? FROM answers WHERE id=? AND kind='written' AND status='pending' ON CONFLICT(answer_id) DO NOTHING").bind(JSON.stringify(payload),time,answerId);
}
async function api(env,path,data) {
  if(!env.LLM_JOBS_API_KEY||!env.LLM_JOBS)throw new Error('jobs_not_configured');
  const r=await env.LLM_JOBS.fetch('https://hermes-llm-jobs.kazumasa.workers.dev'+path,{
    // Workers supports manual/follow only. Reject redirects via the !r.ok check below.
    method:data===undefined?'GET':'POST',redirect:'manual',signal:AbortSignal.timeout(10000),
    headers:{Authorization:'Bearer '+env.LLM_JOBS_API_KEY,'Content-Type':'application/json'},
    ...(data===undefined?{}:{body:JSON.stringify(data)})
  });
  if(!r.ok){await r.body?.cancel();throw new Error('jobs_http_'+r.status);}
  return r.json();
}
async function reflect(env,row,job) {
  const time=now();
  if(job.status==='failed') {
    await env.DB.batch([
      env.DB.prepare("UPDATE answers SET status='needs_review',score=NULL,last_error='job_failed' WHERE id=? AND status='pending'").bind(row.answer_id),
      env.DB.prepare("UPDATE quiz_job_outbox SET status='failed',last_error='job_failed' WHERE answer_id=?").bind(row.answer_id)
    ]);return;
  }
  if(job.status!=='completed')return;
  const a=await env.DB.prepare('SELECT question_json FROM answers WHERE id=?').bind(row.answer_id).first();
  if(!a)throw new Error('missing_answer');
  const grade=validateGrade(job.result,JSON.parse(a.question_json)), fingerprint=await hash(JSON.stringify(grade)), status=grade.confidence<.65?'needs_review':'graded';
  await env.DB.batch([
    env.DB.prepare("INSERT INTO grades(answer_id,score,confidence,feedback,criteria_json,model,prompt_version,request_hash,created_at) SELECT id,?,?,?,?,?,?,?,? FROM answers WHERE id=? AND status='pending' ON CONFLICT(answer_id) DO NOTHING").bind(grade.score,grade.confidence,grade.feedback,JSON.stringify(grade.criteria),grade.model,grade.promptVersion,fingerprint,time,row.answer_id),
    env.DB.prepare("UPDATE answers SET status=?,score=?,graded_at=?,lease_digest=NULL,lease_expires_at=NULL,last_error=NULL WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM grades WHERE answer_id=? AND request_hash=?)").bind(status,status==='graded'?grade.score:null,time,row.answer_id,row.answer_id,fingerprint),
    env.DB.prepare("UPDATE quiz_job_outbox SET status='completed',last_error=NULL WHERE answer_id=? AND EXISTS(SELECT 1 FROM grades WHERE answer_id=?)").bind(row.answer_id,row.answer_id)
  ]);
}
export async function syncQuizJobs(env,attemptId=null) {
  const time=now();
  const rows=(await env.DB.prepare("SELECT o.* FROM quiz_job_outbox o JOIN answers a ON a.id=o.answer_id WHERE o.status='pending' AND o.next_sync_at<=? AND (? IS NULL OR a.attempt_id=?) ORDER BY o.next_sync_at,o.created_at LIMIT 3").bind(time,attemptId,attemptId).all()).results;
  for(const row of rows) {
    // Atomic scheduling claim limits simultaneous browser/Cron reconciliation.
    const claimed=await env.DB.prepare("UPDATE quiz_job_outbox SET next_sync_at=? WHERE answer_id=? AND status='pending' AND next_sync_at<=?").bind(time+30,row.answer_id,time).run();
    if(!claimed.meta.changes)continue;
    try {
      if(!row.job_id) {
        const job=await api(env,'/api/jobs',{type:'quiz.grade',version:1,idempotencyKey:row.answer_id,payload:JSON.parse(row.payload_json)});
        row.job_id=job.id;
        await env.DB.prepare('UPDATE quiz_job_outbox SET job_id=?,last_error=NULL WHERE answer_id=?').bind(job.id,row.answer_id).run();
      }
      const job=await api(env,'/api/jobs/'+encodeURIComponent(row.job_id));
      await reflect(env,row,job);
      await env.DB.prepare('UPDATE quiz_job_outbox SET last_error=NULL WHERE answer_id=?').bind(row.answer_id).run();
    } catch(e) {
      const reason=/^jobs_http_\d+$/.test(e.message)?e.message:'job_sync_failed';
      await env.DB.prepare("UPDATE quiz_job_outbox SET last_error=?,next_sync_at=? WHERE answer_id=? AND status='pending'").bind(reason,time+60,row.answer_id).run();
      console.error('quiz_job_sync_failed',{reason});
    }
  }
}
