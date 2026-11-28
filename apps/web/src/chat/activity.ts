type Work = { active: string; review: string };
function field(value: unknown, key: string): string {
  const item = value && typeof value === 'object' ? Reflect.get(value, key) : undefined;
  return typeof item === 'string' ? item : '';
}
function describe(name: string, args: unknown, depth = 0): Work {
  if (name === 'tool_call' && depth < 2 && args && typeof args === 'object') {
    const calls: unknown = Reflect.get(args, 'calls');
    const call: unknown = Array.isArray(calls) ? calls[0] : args;
    const nested = field(call, 'name');
    if (nested && call && typeof call === 'object')
      return describe(nested, Reflect.get(call, 'arguments'), depth + 1);
  }
  const operation = field(args, 'operation') || field(args, 'action');
  if (name === 'workspace_work') {
    return ['work.describe', 'work.board', 'work.task', 'work.plans'].includes(operation)
      ? { active: 'Checking project progress', review: 'Reviewing the project details' }
      : { active: 'Updating the project', review: 'Checking the project changes' };
  }
  switch (name) {
    case 'read_file':
    case 'read_files':
      return { active: 'Reading project files', review: 'Reviewing the files' };
    case 'write_file':
    case 'patch':
    case 'apply_patch':
      return { active: 'Updating project files', review: 'Checking the changes' };
    case 'search_files':
    case 'search':
      return { active: 'Looking through files', review: 'Reviewing what I found' };
    case 'terminal':
    case 'exec_command':
      return { active: 'Running a command', review: 'Reviewing the result' };
    case 'web_search':
      return { active: 'Searching the web', review: 'Reviewing the search results' };
    case 'web_extract':
    case 'web_fetch':
      return { active: 'Reading the website', review: 'Reviewing the page' };
    case 'browser':
    case 'browser_navigate':
      return { active: 'Checking the website', review: 'Reviewing the website' };
    case 'delegate_task':
    case 'message_agent':
      return { active: 'Coordinating with another pebble', review: 'Following up on the handoff' };
    case 'workspace_agents':
      return operation === 'describe' || operation === 'sidebar.describe'
        ? { active: 'Checking the pebbles', review: 'Reviewing the pebble details' }
        : { active: 'Updating the pebbles', review: 'Checking the changes' };
    case 'pebble_react':
    case 'react_to_message':
      return { active: 'Reacting', review: 'Finishing up' };
    case 'tool_search':
    case 'tool_describe':
      return { active: 'Checking available tools', review: 'Reviewing the available tools' };
    default:
      return { active: 'Working on your request', review: 'Reviewing the result' };
  }
}

/** Public activity only; no reasoning text or raw tool arguments become captions. */
export class WorkProgress {
  private scope = '';
  private authored = '';
  private tools = new Map<string, Work>();
  private label = '';
  bind(scope: string, running: boolean): string {
    if (scope !== this.scope) {
      this.scope = scope;
      this.begin();
    }
    if (!running) return this.reply();
    return this.label || 'Working on your request';
  }
  begin(): string {
    this.authored = '';
    this.tools.clear();
    this.label = 'Thinking';
    return this.label;
  }
  toolStarted(id: string, name: string, args: unknown): string {
    if (name === 'pebble_progress') return this.label;
    const work = describe(name, args);
    this.tools.set(id || name, work);
    if (this.tools.size > 64) {
      const oldest = this.tools.keys().next();
      if (!oldest.done) this.tools.delete(oldest.value);
    }
    this.label = this.authored || work.active;
    return this.label;
  }
  toolCompleted(id: string, name: string): string {
    if (name === 'pebble_progress') return this.label;
    const key = id || name,
      done = this.tools.get(key);
    this.tools.delete(key);
    const active = [...this.tools.values()].at(-1);
    this.label =
      this.authored || active?.active || done?.review || this.label || 'Reviewing the result';
    return this.label;
  }
  status(kind: string, text: string): string {
    if (kind === 'progress' && text.trim()) {
      this.authored = text.replace(/\s+/gu, ' ').trim().slice(0, 120);
      this.label = this.authored;
    } else if (kind === 'compacting') this.label = this.authored || 'Summarizing earlier messages';
    else if (!this.label) this.label = 'Thinking';
    return this.label;
  }
  reply(): string {
    this.authored = '';
    this.tools.clear();
    this.label = '';
    return '';
  }
}
