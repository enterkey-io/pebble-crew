import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageBody } from './MessageBody';
import type { WorkspaceBot } from '@hermes-client/protocol';
import { TooltipProvider } from './components/ui/tooltip';

describe('private bot message rendering', () => {
  it('renders useful Markdown and code without executing HTML or loading remote images', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <MessageBody
          text={
            '## Result\n\n- **Done**\n\n```sh\necho "hello"\n```\n\n![private image](https://tracker.invalid/pixel)\n\n<script>alert(1)</script>\n<iframe src="https://tracker.invalid"></iframe>'
          }
        />
      </TooltipProvider>,
    );
    expect(html).toMatch(/<h2\b[^>]*>Result<\/h2>/);
    expect(html).toContain('<strong>Done</strong>');
    expect(html).toContain('Copy code');
    expect(html).toContain('echo &quot;hello&quot;');
    expect(html).not.toMatch(/<(img|script|iframe)\b/);
    expect(html).toContain('href="https://tracker.invalid/pixel"');
    expect(html).toContain('referrerPolicy="no-referrer"');
  });
  it('rejects executable and relative links while making explicit web links safe to open', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <MessageBody
          text={
            '[unsafe](javascript:alert%281%29) [relative](/settings) [reference](https://example.test/docs)'
          }
        />
      </TooltipProvider>,
    );
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('href="/settings"');
    expect(html).toContain('href="https://example.test/docs"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('referrerPolicy="no-referrer"');
  });
});

const tina: WorkspaceBot = {
  id: 'synthetic-tina-id',
  profile: 'friend-7c18d43223d1407e',
  handle: 'tina',
  name: 'Tina',
  description: 'Synthetic profile',
  managed: true,
  enrolled: true,
  canonical: true,
  manager: null,
  team: null,
  appearance: { kind: 'shape', shape: 'pebble', color: 'sky' },
  role: {
    title: 'Researcher',
    description: '',
    responsibilities: '',
    boundaries: '',
    expectedOutputs: '',
  },
};

describe('resolved message mentions', () => {
  const mentions = new Map([
    ['tina', tina],
    ['old-tina', tina],
  ]);
  function render(text: string) {
    return renderToStaticMarkup(
      <TooltipProvider>
        <MessageBody text={text} mentions={mentions} />
      </TooltipProvider>,
    );
  }

  it('renders current and roster-backed legacy tokens as accessible stable-identity controls', () => {
    const html = render('Hello **@tina**, ask @old-tina and @TINA. Leave @unknown alone.');
    expect(html.match(/aria-label="View Tina&#x27;s profile"/g) ?? []).toHaveLength(3);
    expect(html.match(/data-mention-id="synthetic-tina-id"/g) ?? []).toHaveLength(3);
    expect(html).toContain('>@old-tina</button>');
    expect(html).toContain('@unknown');
    expect(html).not.toContain('data-mention-id="unknown"');
  });

  it('preserves code, link labels, URLs, emails and unknown or partial tokens', () => {
    const html = render(
      [
        '@tina',
        '`@tina`',
        '```text\n@tina\n```',
        'https://example.test/@tina',
        '<https://example.test/@tina>',
        'person@tina.test',
        '[@tina](https://example.test)',
        '![image @tina](https://example.test/image.png)',
        '@tina-extra @unknown prefix@tina',
      ].join('\n\n'),
    );
    expect(html.match(/data-mention-id="synthetic-tina-id"/g) ?? []).toHaveLength(1);
    expect(html).toContain('href="https://example.test/@tina"');
    expect(html).toContain('<code');
    expect(html).toContain('@tina-extra @unknown prefix@tina');
  });
});

describe('owner message Markdown', () => {
  it('formats Markdown while preserving line breaks, escaped mentions and code', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <MessageBody
          owner
          text={'Hello  **@tina**\n_italic_ `@tina` \\@tina'}
          mentions={new Map([['tina', tina]])}
        />
      </TooltipProvider>,
    );
    expect(html.match(/data-mention-id="synthetic-tina-id"/g) ?? []).toHaveLength(1);
    expect(html).toContain('<strong>');
    expect(html).toContain('<em class="italic">italic</em>');
    expect(html).toContain('Hello  ');
    expect(html).toContain('whitespace-pre-wrap');
  });
});
