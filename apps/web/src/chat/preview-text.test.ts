import { expect, it } from 'vitest';
import { previewText } from './preview-text';

it('preserves readable message text and accents without Markdown controls or link destinations', () => {
  expect(
    previewText('## Plan\n\n**Öykü** is _ready_. [Read the brief](https://example.test/private).'),
  ).toBe('Plan Öykü is ready. Read the brief.');
  expect(previewText('- **Review** the brief\n- Publish it')).toBe('Review the brief Publish it');
  expect(previewText('Use `run.js` when ready.')).toBe('Use run.js when ready.');
  expect(previewText('| Name | State |\n| --- | --- |\n| Öykü | Ready |')).toBe(
    'Name State Öykü Ready',
  );
});

it('labels code, script blocks and shared photos instead of exposing their source', () => {
  expect(previewText('```js\nconst secret = "example";\n```')).toBe('Code snippet');
  expect(previewText('<script>alert("never executed")</script>')).toBe('Code snippet');
  expect(previewText('The example is ready.\n\n```python\nprint("hello")\n```')).toBe(
    'The example is ready. Code snippet',
  );
  expect(previewText('![A mockup](attachment://photo-1)')).toBe('Photo');
  expect(previewText('MEDIA: /private/project/photo.png')).toBe('Photo');
  expect(previewText('Hello <span>Öykü</span>')).toBe('Hello Öykü');
});

it('keeps long or empty previews bounded and stable', () => {
  expect(previewText('  \n ')).toBe('');
  expect(previewText('x'.repeat(10000))).toHaveLength(240);
  expect(previewText('**Saved** preview')).toBe('Saved preview');
  expect(previewText('**Saved** preview')).toBe('Saved preview');
});
