"""Project authenticated uploads for display without changing Hermes model/history content."""
import json
from pathlib import PurePosixPath
import re

REFERENCE = re.compile(r'''@(?:file|image):(?:`[^`\n]+`|"(?:\\.|[^"\\\n])*"|'[^'\n]+'|[^\s]+)''')
FOOTER = re.compile(r'\n\n--- (?:Context Warnings|Attached Context) ---\n')


def trailing_uploads(text, files):
    """Only the native trailing reference cluster proves a generated footer's boundary."""
    end = len(text.rstrip())
    found = []
    matches = list(REFERENCE.finditer(text[:end]))
    for match in reversed(matches):
        if text[match.end():end].strip():
            break
        raw = match.group().split(':', 1)[1]
        if raw.startswith('"'):
            try:
                raw = json.loads(raw)
            except ValueError:
                return None
        elif raw.startswith(('`', "'")):
            raw = raw[1:-1]
        name = PurePosixPath(raw.replace('\\', '/')).name
        file = next((f for f in files if name.startswith((f['id'] + '_', 'pebble_' + f['id'] + '_'))), None)
        if file is None:
            return None
        if file['id'] not in {f['id'] for f in found}:
            found.insert(0, file)
        end = match.start()
    if not found:
        return None
    caption = text[:end].rstrip()
    if caption == 'Please review the attached files.':
        caption = ''
    return caption, [{k: file[k] for k in ('id', 'name', 'size')} for file in found]


def project_message(row, files):
    if row.get('role') != 'user' or not isinstance(row.get('text'), str):
        return row
    text = row['text']
    for marker in FOOTER.finditer(text):
        projected = trailing_uploads(text[:marker.start()], files)
        if projected:
            return {**row, 'text': projected[0], 'shared_files': projected[1]}
    projected = trailing_uploads(text, files)
    return {**row, 'text': projected[0], 'shared_files': projected[1]} if projected else row
