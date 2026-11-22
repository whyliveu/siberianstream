from pathlib import Path
import shutil
source=Path('dist');target=Path('_site')
shutil.copytree(source,target,dirs_exist_ok=True)
html=(target/'index.html').read_text()
origin='https://siberianstream.7marias5.workers.dev'
public_origin='https://mashkasad.online'
html=html.replace(origin,public_origin)
html=html.replace('src="/assets/','src="./assets/').replace('url(/fonts/','url(./fonts/')
html=html.replace("fetch('/status.json'","fetch('./status.json'")
assert origin not in html
assert 'src="/assets/' not in html
assert 'url(/fonts/' not in html
assert "fetch('/status.json'" not in html
assert 'KISS SUPPORT FOR STREAM' in html
assert 'До начала:' in html
(target/'index.html').write_text(html)
(target/'.nojekyll').write_text('')
for name in ['_headers','_redirects']:
 p=target/name
 if p.exists():p.unlink()
print('GitHub Pages build ready: relative assets, status and canonical URL verified.')
