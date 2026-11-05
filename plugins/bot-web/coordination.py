"""Explicit goal context for text, groups, peer exchanges, voice and workers."""
import json
from .plans import saved_plans, board_key


def context(store, profile, board=None):
    state = store.read()
    bot = state['bots'].get(profile)
    if not bot or not bot.get('enrolled') or not bot.get('available', True) or bot.get('deleted'):
        return {}
    data = {'workspace_id': state['id'], 'tasks_enabled': state.get('features', {}).get('tasks') is not False,
        'policy': 'Sections organize the interface only. Group participants are explicitly selected. Neither grants authority or changes reporting. Goals guide work; they never authorize starting tasks, spending money or external actions.'}
    if not data['tasks_enabled']:
        data['policy'] += ' Tasks and goals are off: do not use saved Plans or project outcomes. Native Kanban remains available for background work.'
        return data
    graph = saved_plans(store, state)
    is_main = profile == state.get('orchestrator')
    selected = {p['id'] for p in graph['plans'] if p['status'] == 'active' and
        (is_main or p['parent_id'] is None or p['owner_id'] == bot['id'] or
         (board and board_key(board) in [board_key(ref) for ref in p['boards']]))}
    by_id = {p['id']: p for p in graph['plans']}
    for ident in list(selected):
        parent = by_id[ident]['parent_id']
        while parent in by_id and parent not in selected:
            selected.add(parent)
            parent = by_id[parent]['parent_id']
    related = [v for v in graph['board_outcomes'] if is_main or (board and board_key(v['board']) == board_key(board))]
    data.update(plans_revision=graph['revision'], goals=[], goal_count=len(selected), board_outcome=None,
        project_outcomes=[], project_outcome_count=len(related))
    if board:
        data['board_outcome'] = next((v for v in related if board_key(v['board']) == board_key(board)), None)
    for value in related:
        data['project_outcomes'].append(value)
        if len(json.dumps(data, ensure_ascii=False)) > 4500:
            data['project_outcomes'].pop()
            break
    def priority(plan):
        if board and any(board_key(board) == board_key(ref) for ref in plan['boards']): return 0
        return 1 if plan['owner_id'] == bot['id'] else 2
    for plan in sorted(graph['plans'], key=priority):
        if plan['id'] not in selected:
            continue
        goal = {k: plan[k] for k in ('id', 'title', 'outcome', 'status', 'owner_id', 'parent_id')}
        data['goals'].append(goal)
        if len(json.dumps(data, ensure_ascii=False)) > 4500:
            goal.pop('outcome')
            goal['outcome_available_in_plans'] = True
        if len(data['goals']) >= 8:
            break
    while data['goals'] and len(json.dumps(data, ensure_ascii=False)) > 5000:
        data['goals'].pop()
    data['goals_more'] = len(selected) > len(data['goals'])
    return data


def voice_context(store, profile):
    from .identity import hierarchy_context
    state = store.read()
    hierarchy = hierarchy_context(state, profile)
    return 'Current Pebble Crew identity and coordination: ' + json.dumps({
        'you': '@' + state['bots'][profile]['handle'],
        'main_pebble': hierarchy['main_pebble'],
        'your_reporting_path': hierarchy['your_reporting_path'],
        'coordination': context(store, profile),
        'policy': 'Preserve your existing personality. This current hierarchy is authoritative; job titles and older prose do not change reporting. Use your existing native delegation for actions, never claim a queued action is completed.'}, ensure_ascii=False)


def worker_profile(store):
    from pathlib import Path
    from hermes_constants import get_hermes_home
    from hermes_cli.profiles import get_profile_dir
    from .search_native import identity
    state = store.read()
    home = get_hermes_home().resolve()
    profiles = [p for p, b in state['bots'].items() if b.get('enrolled') and b.get('available', True) and not b.get('deleted') and Path(get_profile_dir(p)).resolve() == home and identity(home) == b.get('native_incarnation')]
    return profiles[0] if len(profiles) == 1 else None


def worker_context():
    """Read only the dispatcher's exact current profile and board, never a UI selection."""
    from contextlib import closing
    from pathlib import Path
    import sqlite3
    from hermes_constants import get_hermes_home
    from hermes_cli import kanban_db
    from hermes_cli.profiles import get_profile_dir
    from .search_native import identity
    from .workspace import WorkspaceStore, workspace_path
    from .work_native import NativeWork
    path = workspace_path()
    if not path.is_file() or not path.with_name('work.sqlite').is_file():
        return ''
    store = WorkspaceStore(path)
    try:
        state = store.read()
        profile = worker_profile(store)
        if not profile:
            return ''
        actual = Path(kanban_db.kanban_db_path()).resolve()
        root = kanban_db.kanban_home().resolve()
        if actual == root / 'kanban.db':
            slug = 'default'
        elif actual.name == 'kanban.db' and actual.parent.parent == root / 'kanban' / 'boards':
            slug = actual.parent.name
        else:
            return ''
        with closing(sqlite3.connect(path.with_name('work.sqlite').resolve().as_uri() + '?mode=ro', uri=True)) as db:
            row = db.execute('SELECT identity FROM catalog WHERE workspace=?', (state['id'],)).fetchone()
        catalog = next((b for b in state['bots'].values() if row and b['id'] == row[0] and b.get('available', True) and not b.get('deleted')), None)
        if not catalog or identity(Path(get_profile_dir(catalog['profile']))) != catalog.get('native_incarnation'):
            return ''
        native = NativeWork(catalog['profile'])
        with native.scoped():
            meta = native.kanban.read_board_metadata(slug)
            project = native.project(meta['project_id']) if meta.get('project_id') else None
            ref = {'catalog_id': catalog['id'], 'project_id': project['id'], 'slug': slug} if project and project.get('board_slug') == slug else None
        return '\nCurrent project coordination: ' + json.dumps(context(store, profile, ref), ensure_ascii=False)
    finally:
        store.db.close()
