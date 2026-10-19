import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tool } from './tool';
import { Activity } from './activity';
import { toolGroupIcon } from './activity-icons';
import { BookOpen, Wrench } from 'lucide-react';

describe('recognizable activity types', () => {
  it.each([
    ['read_file', 'book-open'],
    ['tools.read_files', 'book-open'],
    ['terminal', 'square-terminal'],
    ['exec_command', 'square-terminal'],
    ['vision_analyze', 'image'],
    ['mcp__images__view_image', 'image'],
    ['write_file', 'file-pen-line'],
    ['web_search', 'globe'],
    ['message_agent', 'messages-square'],
    ['pebble_open_document', 'file-text'],
    ['unknown_extension', 'wrench'],
  ])('renders a meaningful icon for %s', (name, icon) => {
    const html = renderToStaticMarkup(<Tool id="test" name={name} state="unknown" />);
    expect(html).toContain(`lucide-${icon}`);
    expect(html).not.toContain('lucide-circle ');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(name);
  });
  it('represents mixed tool groups with a wrench and uniform reads with a book', () => {
    expect(toolGroupIcon(['read_file', 'read_files'])).toBe(BookOpen);
    expect(toolGroupIcon(['terminal', 'read_file'])).toBe(Wrench);
  });
  it('keeps general public activity and errors distinct from tool operations', () => {
    expect(renderToStaticMarkup(<Activity title="Update" state="unknown" />)).toContain(
      'lucide-activity',
    );
    expect(renderToStaticMarkup(<Tool id="failed" name="read_file" state="failed" />)).toContain(
      'data-status="error"',
    );
  });
});
