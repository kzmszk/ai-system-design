from pathlib import Path
import re
root = Path(__file__).resolve().parent
public = root / 'dist'
html = (public / 'index.html').read_text()
css = (public / 'styles.css').read_text()
css = re.sub(r"@import url\([^;]+;\n", '', css)
parts = []
for name in ['bank.js', 'engine.js', 'app.js']:
    source = (public / name).read_text()
    source = re.sub(r'^import .+;\n', '', source, flags=re.M)
    source = re.sub(r'^export ', '', source, flags=re.M)
    parts.append(source)
script = '\n'.join(parts)
html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>' + css + '</style>')
html = html.replace('<script type="module" src="app.js"></script>', '<script type="module">' + script + '</script>')
html = html.replace('href="LICENSE.txt"', 'href="https://www.apache.org/licenses/LICENSE-2.0"')
html += '\n<!--\n' + (public / 'NOTICE.txt').read_text() + '\n' + (public / 'LICENSE.txt').read_text() + '\n-->\n'
output = root / 'AI理解度チェック.html'
output.write_text(html)
Path('/tmp/ai-design-quiz-standalone.mjs').write_text(script)
print(str(output))
