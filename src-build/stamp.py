# Puts a version on every reference to a script or a stylesheet of the site: "/assets/render.js" becomes
# "/assets/render.js?v=3fa9c01b2e". The version is made of the file's own words and of the versions of what
# the file itself refers to (boot.js loads book3d.js, which reads techo.css: change the CSS and all three
# change), so a file's address changes when, and only when, something it is made of changes. That lets
# public/_headers keep /assets/* and /vendor/* for a year: a new deploy is new addresses.
#
# It runs at the end of build.py and of `npm run build:3d` (each starts from freshly written files), and
# can run alone: python3 src-build/stamp.py [--check]. --check writes nothing and fails if a file is out of date.
import hashlib, os, re, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pub = os.path.join(root, 'public')
check = '--check' in sys.argv

# what can be referred to: /assets/*.js|css and /vendor/*.js|css, by address
known = {}
for d in ('assets', 'vendor'):
    base = os.path.join(pub, d)
    for name in sorted(os.listdir(base)) if os.path.isdir(base) else []:
        if name.endswith(('.js', '.css')):
            known['/%s/%s' % (d, name)] = os.path.join(base, name)

# a reference: after a quote, "(" or "=" (so not a path in a comment, nor an escaped one in a regex), with
# a version already on it or not
REF = re.compile(r'''(?<=["'`(=])(/(?:assets|vendor)/[\w.-]+\.(?:js|css))(?:\?v=[0-9a-f]{10})?''')

def read(p):
    with open(p, encoding='utf-8', newline='') as f:
        return f.read()

def plain(text):
    return REF.sub(r'\1', text)

def refs(text, me):
    return sorted({m for m in REF.findall(text) if m in known and m != me})

cache, visiting = {}, []
def version(addr):
    if addr in cache:
        return cache[addr]
    if addr in visiting:
        raise SystemExit('stamp: files refer to each other in a circle: ' + ' -> '.join(visiting + [addr]))
    visiting.append(addr)
    text = plain(read(known[addr]))
    h = hashlib.sha256(text.encode('utf-8'))
    for dep in refs(text, addr):
        h.update(version(dep).encode())
    visiting.pop()
    cache[addr] = h.hexdigest()[:10]
    return cache[addr]

# what may hold references: the pages and the scripts and stylesheets themselves
targets = []
for cur, dirs, files in os.walk(pub):
    for name in files:
        if name.endswith(('.html', '.js', '.css')):
            targets.append(os.path.join(cur, name))

stale = []
for p in sorted(targets):
    text = read(p)
    me = next((a for a, q in known.items() if q == p), None)
    new = REF.sub(lambda m: m.group(1) + '?v=' + version(m.group(1)) if m.group(1) in known and m.group(1) != me else m.group(1), text)
    if new != text:
        stale.append(os.path.relpath(p, root))
        if not check:
            with open(p, 'w', encoding='utf-8', newline='') as f:
                f.write(new)

if check:
    if stale:
        print('stamp: out of date (run python3 src-build/stamp.py): ' + ', '.join(stale))
        sys.exit(1)
    print('stamp: up to date')
else:
    print('stamp: %d files stamped, %d addresses' % (len(stale), len(known)))
