"""Smaller copies of chat photos so the browser never loads an original just to show it.

`thumb` fills the viewer's thumbnail row and the cards of a photo stack; `preview`
fills a chat bubble or the viewer while the original loads. Originals stay unchanged.
"""
import io
import time
from collections import OrderedDict

VARIANTS = {'thumb': 360, 'preview': 1280}
CACHE_BYTES = 96 * 1024 * 1024
CACHE_ENTRY = 12 * 1024 * 1024
CACHE_SECONDS = 15 * 60


def variant(params):
    """The requested size, or None for the original. Removes the field from `params`."""
    value = params.pop('variant', None)
    if value is None or value == 'full':
        return None
    if value not in VARIANTS:
        from .operations import InvalidOperation
        raise InvalidOperation('Choose a photo size')
    return value


def resize(blob, mime, size):
    """Returns (bytes, mime). Anything that is not a still PNG/JPEG/WebP comes back as is."""
    if mime not in ('image/png', 'image/jpeg', 'image/webp'):
        return blob, mime
    limit = VARIANTS[size]
    from PIL import Image, ImageOps
    with Image.open(io.BytesIO(blob)) as image:
        image.draft('RGB', (limit, limit))  # JPEG decodes at a reduced scale; much faster.
        image = ImageOps.exif_transpose(image)
        if max(image.size) <= limit and len(blob) <= 400_000 and mime != 'image/jpeg':
            return blob, mime
        image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
        alpha = image.mode in ('RGBA', 'LA') or (image.mode == 'P' and 'transparency' in image.info)
        image = image.convert('RGBA' if alpha else 'RGB')
        out = io.BytesIO()
        if alpha:
            image.save(out, 'WEBP', quality=80, method=4)
            return out.getvalue(), 'image/webp'
        image.save(out, 'JPEG', quality=80 if size == 'thumb' else 84, optimize=True, progressive=True)
        resized = out.getvalue()
    return (resized, 'image/jpeg') if len(resized) < len(blob) else (blob, mime)


class PhotoCache:
    """Recently read photos and their smaller copies, bounded by bytes and age."""

    def __init__(self, budget=CACHE_BYTES):
        self.budget = budget
        self.used = 0
        self.items = OrderedDict()

    def get(self, key):
        item = self.items.get(key)
        if not item:
            return None
        if item[0] < time.monotonic():
            self.drop(key)
            return None
        self.items.move_to_end(key)
        return item[1]

    def put(self, key, value):
        size = len(value[0])
        if size > CACHE_ENTRY:
            return
        self.drop(key)
        self.items[key] = (time.monotonic() + CACHE_SECONDS, value)
        self.used += size
        while self.used > self.budget and self.items:
            self.drop(next(iter(self.items)))

    def drop(self, key):
        item = self.items.pop(key, None)
        if item:
            self.used -= len(item[1][0])
