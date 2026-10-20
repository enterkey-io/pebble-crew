"""Owner-local queue nudges and comment mentions; no vendor relay or model at install."""
from pathlib import Path


def read_delivery_task(service, native, board, task):
    from fastapi import HTTPException
    try:
        return native.task(board, task)
    except HTTPException as error:
        if error.status_code != 404:
            raise
        with service.store.db:
            service.store.db.execute('DELETE FROM task_watches WHERE board=? AND task=?', (board, task))
            for table in ('mentions', 'task_notifications'):
                service.store.db.execute(f"UPDATE {table} SET state='unavailable' WHERE board=? AND task=? AND state='pending'", (board, task))
        return None


def tick():
    from .workspace import WorkspaceStore, workspace_path
    from .work import WorkService
    path = workspace_path()
    if not path.with_name('work.sqlite').exists():
        return []
    workspace = WorkspaceStore(path)
    service = WorkService(workspace, path.with_name('work.sqlite'))
    try:
        with service.store.locked():
            state = workspace.read()
            catalog = service.store.catalog(state)
            from .search_native import identity
            from hermes_cli.profiles import get_profile_dir
            if identity(Path(get_profile_dir(catalog['profile']))) != catalog.get('native_incarnation'):
                return []
            native = service.native_factory(catalog['profile'])
            with native.scoped():
                boards = {b['slug']: b for b in service.describe(state, native)['boards']}
                for (slug,) in service.store.db.execute('SELECT slug FROM dispatch_boards'):
                    if boards.get(slug, {}).get('mapping') not in ('general', 'linked'):
                        continue
                    view = native.board(slug)
                    active = [t for c in view['columns'] for t in c['tasks']
                        if t['status'] in ('todo', 'ready', 'running', 'review')]
                    if active:
                        native.dispatch(slug)
                pending = []
                for board, task_id, profile, incarnation, cursor in list(service.store.db.execute(
                        'SELECT board,task,profile,identity,cursor FROM task_watches')):
                    if boards.get(board, {}).get('mapping') not in ('general', 'linked'):
                        continue
                    detail = read_delivery_task(service, native, board, task_id)
                    if detail is None:
                        continue
                    events = [e for e in detail.get('events', []) if e['id'] > cursor]
                    with service.store.db:
                        for event in events:
                            if event['kind'] in ('completed', 'blocked', 'review_requested') and event.get('run_id'):
                                run = next((r for r in detail.get('runs', []) if r['id'] == event['run_id']), {})
                                if run.get('profile') == profile:
                                    service.store.db.execute('INSERT OR IGNORE INTO task_notifications VALUES(?,?,?,?,?,?,?)',
                                        (f"task:{board}:{event['id']}", board, task_id, event['id'], profile, incarnation, 'pending'))
                        if events:
                            service.store.db.execute('UPDATE task_watches SET cursor=? WHERE board=? AND task=?',
                                (max(e['id'] for e in events), board, task_id))
                        if detail['task']['status'] in ('done', 'archived'):
                            service.store.db.execute('DELETE FROM task_watches WHERE board=? AND task=?', (board, task_id))
                for ident, board, task_id, event_id, profile, incarnation in list(service.store.db.execute(
                        "SELECT id,board,task,event,profile,identity FROM task_notifications WHERE state='pending' LIMIT 8")):
                    bot = state['bots'].get(profile)
                    if not bot or bot['id'] != incarnation or not bot.get('enrolled') or not bot.get('available', True) or bot.get('deleted'):
                        with service.store.db:
                            service.store.db.execute("UPDATE task_notifications SET state='unavailable' WHERE id=?", (ident,))
                        continue
                    detail = read_delivery_task(service, native, board, task_id)
                    if detail is None:
                        continue
                    event = next((e for e in detail.get('events', []) if e['id'] == event_id), None)
                    if not event:
                        continue
                    run = next((r for r in detail.get('runs', []) if r['id'] == event.get('run_id')), {})
                    import json
                    record = {'board': board, 'task': task_id, 'title': detail['task']['title'],
                        'requested_work': detail['task'].get('body'), 'event': event['kind'],
                        'summary': run.get('summary'), 'result': detail['task'].get('result')}
                    pending.append({'id': ident, 'profile': profile, 'identity': incarnation,
                        'text': 'A Hermes task worker has reported an outcome. Give the owner a concise update in this existing Bot Chat. '
                        'If the requested deliverable was a message to the owner, deliver that message here from the recorded result. '
                        'Do not restart the task or claim unverified actions. A blocked/review outcome is not completion. '
                        'Read the task if more context is needed. Native task record:\n'+json.dumps(record)})
                rows = list(service.store.db.execute("SELECT id,profile,identity,board,task,comment FROM mentions WHERE state='pending' LIMIT 8"))
                for ident, profile, incarnation, board, task_id, comment_id in rows:
                    bot = state['bots'].get(profile)
                    if not bot or bot['id'] != incarnation or not bot.get('enrolled') or not bot.get('available', True) or bot.get('deleted'):
                        with service.store.db:
                            service.store.db.execute("UPDATE mentions SET state='unavailable' WHERE id=?", (ident,))
                        continue
                    detail = read_delivery_task(service, native, board, task_id)
                    if detail is None:
                        continue
                    comment = next((c for c in detail['comments'] if c['id'] == comment_id), None)
                    if not comment:
                        continue
                    pending.append({'id': ident, 'profile': profile, 'identity': incarnation,
                        'text': f"You were mentioned in a Pebble Crew task comment. Read and respond as appropriate; a mention is not a change of assignee.\nBoard: {board}\nTask: {task_id} — {detail['task']['title']}\nComment by {comment['author']}:\n{comment['body']}\nUse workspace_work work.task to read the full task with workspace_id {state['id']!r}, board {board!r}, id {task_id!r}."})
                return pending
    finally:
        service.close()
        workspace.db.close()


def settle(ident, state):
    from .workspace import workspace_path
    from .work_store import WorkStore
    path = workspace_path().with_name('work.sqlite')
    if not path.exists():
        return False
    store = WorkStore(path)
    try:
        with store.locked(), store.db:
            if state == 'recover':
                store.db.execute("UPDATE mentions SET state='uncertain' WHERE state='sending'")
                store.db.execute("UPDATE task_notifications SET state='uncertain' WHERE state='sending'")
                return True
            table = 'task_notifications' if ident.startswith('task:') else 'mentions'
            if state == 'sending':
                return store.db.execute(f"UPDATE {table} SET state='sending' WHERE id=? AND state='pending'", (ident,)).rowcount == 1
            if state in ('sent', 'uncertain', 'unavailable'):
                store.db.execute(f"UPDATE {table} SET state=? WHERE id=? AND state='sending'", (state, ident))
                return True
            return False
    finally:
        store.close()


async def deliver(workspace, native):
    jobs = await native.call('bot_web.work_delivery', {'action': 'tick'})
    for job in jobs:
        # Claim before submitting, and never replay a submit with an unknown result.
        if not await native.call('bot_web.work_delivery', {'action': 'sending', 'id': job['id']}):
            continue
        result = 'uncertain'
        try:
            async with workspace.lock:
                state = workspace.store.read()
                bot = state['bots'].get(job['profile'])
                if not bot or bot['id'] != job['identity'] or not bot.get('enrolled') or not bot.get('available', True):
                    result = 'unavailable'
                else:
                    await workspace.ops.greet(job['profile'], job['text'], title='Task update' if job['id'].startswith('task:') else 'Task mention', queued=True)
                    result = 'sent'
        finally:
            await native.call('bot_web.work_delivery', {'action': result, 'id': job['id']})
