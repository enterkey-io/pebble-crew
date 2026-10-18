import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageBody } from './MessageBody';
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
      <MessageBody
        text={
          '[unsafe](javascript:alert%281%29) [relative](/settings) [reference](https://example.test/docs)'
        }
      />,
    );
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('href="/settings"');
    expect(html).toContain('href="https://example.test/docs"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('referrerPolicy="no-referrer"');
  });
});
