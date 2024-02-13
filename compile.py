import http.client
import json
import os
import shutil
import subprocess
import sys
import time
import urllib

class UnsupportedVersion(Exception):
    pass

MIN_VERSION, VERSION_LESS_THAN = (3, 5), (4, 0)
if sys.version_info < MIN_VERSION or sys.version_info >= VERSION_LESS_THAN:
    raise UnsupportedVersion('requires Python %s,<%s' % ('.'.join(map(str, MIN_VERSION)), '.'.join(map(str, VERSION_LESS_THAN))))

__version__ = '1.1.4'

NON_JS_PATHS = [
    './src/index.html',
    './src/public/js/resources.js',
    './src/public/js/three.js',
    './src/public/js/BufferGeometryUtils.js',
]

JS_PATHS = [
    './src/public/tinysequencer/tinysequencer.js',
    './src/public/js/game.js',
]

JS_EXTERNS_PATH = './src/externs.js'

SEVENZIP_PATH = 'C:/Program Files/7-Zip/7z.exe'

print('Reading Javascript files...')

js_code = ''
for path in JS_PATHS:
    with open(path) as js_file:
        js_code += js_file.read() + '\n'
js_code = js_code.replace("'use strict';", '')

with open(JS_EXTERNS_PATH) as js_externs_file:
    js_externs = js_externs_file.read()

print('Creating build directory...')

shutil.rmtree('./build', ignore_errors=True)

time.sleep(2)

os.mkdir('./build')

time.sleep(2)

for path in NON_JS_PATHS:
    shutil.copyfile(path, os.path.join('./build', os.path.basename(path)))

with open('./build/bundle_original.js', 'w') as f:
    f.write(js_code)

print('\nRequesting compiled code from Google Closure Compiler Service API...')
print('  (You must accept the Google Terms of Service to use this API)')

parameters = urllib.parse.urlencode([
    ('js_code', js_code),
    ('js_externs', js_externs),
    ('compilation_level', 'ADVANCED_OPTIMIZATIONS'),
    ('language_out', 'ECMASCRIPT_2017'),
    ('output_format', 'json'),
    ('output_info', 'compiled_code'),
    ('output_info', 'warnings'),
    ('output_info', 'errors'),
    ('output_info', 'statistics'),
])

headers = { 'Content-type': 'application/x-www-form-urlencoded' }
conn = http.client.HTTPSConnection('closure-compiler.appspot.com')
conn.request('POST', '/compile', parameters, headers)
response = conn.getresponse().read()
conn.close()

if len(response) == 0:
    print('Response is empty')
    sys.exit()

output = json.loads(response)

print('Request complete')

if 'serverErrors' in output:
    print('\nServer errors:')
    print('\n'.join('  %i - %s' % (error['code'], error['error']) for error in output['serverErrors']))
    print('\nUnable to proceed due to server errors')
    sys.exit()

if 'errors' in output:
    print('\nErrors:')
    print('\n'.join('  bundle_original.js:%i:%i - %s\n    "%s"' % (
        error['lineno'], error['charno'], error['error'], error['line']) for error in output['errors']))
    print('\nUnable to proceed due to errors')
    sys.exit()

if 'warnings' in output:
    print('\nWarnings:')
    print('\n'.join('  bundle_original.js:%i:%i - %s' % (error['lineno'], error['charno'], error['warning']) for error in output['warnings']))

stats = output['statistics']
print('\nStatistics:\n  Original size: %i bytes\n  Compressed size: %i bytes\n  Compile time: %i seconds' % (
    stats['originalSize'], stats['compressedSize'], stats['compileTime']))

with open('./build/bundle.js', 'w') as f:
    f.write(output['compiledCode'])

time.sleep(2)

print('\nZipping bundle...')

process = subprocess.Popen([
    SEVENZIP_PATH,
    'a',
    './build/compressed.zip',
    './build/bundle.js'] + NON_JS_PATHS,
    stdout=open(os.devnull, 'w'),
    stderr=subprocess.STDOUT)
process.wait()

time.sleep(2)

size = os.stat('./build/compressed.zip').st_size
print('  Final ZIP size: %i bytes' % size)
