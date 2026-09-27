"""Authenticated quiz transport; the Codex task supplies grades, not an LLM API."""
import datetime
import json
import os
from pathlib import Path
import re
import sys
import urllib.request
import urllib.error
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / '.subscription-grader'
BASE = 'https://ai-design-compass.kazumasa.workers.dev'

def private_write(path, value):
    STATE.mkdir(mode=0o700, exist_ok=True)
    temp = path.with_suffix('.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, ensure_ascii=False)
    os.replace(temp, path)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def api(path, data=None):
    config = json.loads((STATE / 'config.json').read_text())
    key = config['apiKey']
    # Identify this client explicitly; Cloudflare rejects urllib's default UA.
    request = urllib.request.Request(BASE + path, data=None if data is None else json.dumps(data, ensure_ascii=False).encode(), headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'User-Agent': 'AI-Design-Compass-Grader/1.0'})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
        return json.load(response)

def main():
    command = sys.argv[1] if len(sys.argv) > 1 else 'pending'
    hour = datetime.datetime.now(ZoneInfo('Asia/Tokyo')).hour
    # A claimed answer may finish just after midnight. Only discovery/claim is gated.
    if command in ['pending', 'claim'] and not 8 <= hour < 24:
        print(json.dumps({'outsideWindow': True, 'timezone': 'Asia/Tokyo'})); return
    if command == 'pending':
        data = api('/api/grading/answers?limit=50')
        print(json.dumps({'ids': [a['id'] for a in data['answers']], 'more': bool(data.get('nextCursor'))})); return
    if command not in ['claim', 'save', 'fail'] or len(sys.argv) != 3:
        raise ValueError('usage: pending | claim ID | save ID < grade.json | fail ID')
    aid = sys.argv[2]
    if not re.fullmatch(r'[A-Za-z0-9-]{1,80}', aid):
        raise ValueError('invalid answer ID')
    lease_path = STATE / (aid + '.json')
    prefix = '/api/grading/answers/' + aid
    if command == 'claim':
        data = api(prefix + '/claim', {})
        private_write(lease_path, {'leaseToken': data['leaseToken'], 'leaseExpiresAt': data['leaseExpiresAt']})
        print(json.dumps({'id': aid, 'question': data['question'], 'answer': data['answer'], 'leaseExpiresAt': data['leaseExpiresAt']}, ensure_ascii=False)); return
    lease = json.loads(lease_path.read_text())
    if command == 'save':
        raw = sys.stdin.read(32769)
        if len(raw) > 32768: raise ValueError('grade too large')
        data = json.loads(raw)
        rows = data.get('criteria', [])
        if len(rows) != 3 or any(r.get('index') != i or type(r.get('points')) is not int or not 0 <= r['points'] <= 2 or not isinstance(r.get('feedback'), str) or not r['feedback'].strip() or len(r['feedback']) > 1000 for i,r in enumerate(rows)):
            raise ValueError('invalid criteria')
        confidence = data.get('confidence')
        if type(confidence) not in (int, float) or not 0 <= confidence <= 1: raise ValueError('invalid confidence')
        if not isinstance(data.get('feedback'), str) or not data['feedback'].strip() or len(data['feedback']) > 2500: raise ValueError('invalid feedback')
        payload = {k: data[k] for k in ['criteria', 'confidence', 'feedback']}
        payload.update(leaseToken=lease['leaseToken'], model='Codex / ChatGPT subscription (task model)', promptVersion='compass-codex-rubric-v2')
        result = api(prefix + '/grade', payload)
    else:
        result = api(prefix + '/fail', {'leaseToken': lease['leaseToken'], 'reason': 'grader_error'})
    lease_path.unlink(missing_ok=True)
    print(json.dumps({'id': aid, **result}, ensure_ascii=False))

if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as error:
        print(json.dumps({'error': 'quiz_api_error', 'status': error.code}), file=sys.stderr); sys.exit(1)
    except (ValueError, KeyError, OSError, urllib.error.URLError):
        print(json.dumps({'error': 'configuration_network_or_input_error'}), file=sys.stderr); sys.exit(1)
