"""Narrow adapters over native project and Kanban services. No worker dispatch."""
from contextlib import closing, contextmanager
from dataclasses import asdict

from .operations import InvalidOperation
from .work_store import fingerprint


TASK_FIELDS = ('id', 'title', 'body', 'status', 'assignee', 'priority', 'project_id', 'result', 'current_run_id')


def task_revision(task):
    return fingerprint({key: task.get(key) for key in TASK_FIELDS})


class GuardedConnection:
    """Validate under the native helper's own SQLite writer lock."""
    def __init__(self, connection, verify):
        self.connection, self.verify = connection, verify

    def __getattr__(self, name):
        return getattr(self.connection, name)

    def execute(self, sql, *args):
        result = self.connection.execute(sql, *args)
        if sql.strip().upper() == 'BEGIN IMMEDIATE':
            try:
                self.verify(self.connection)
            except BaseException:
                self.connection.rollback()
                raise
        return result


class CheckedConnection(GuardedConnection):
    def __init__(self, connection, task_id, expected):
        def verify(conn):
            from hermes_cli import kanban_db
            task = kanban_db.get_task(conn, task_id)
            if task is None or task_revision(asdict(task)) != expected:
                raise InvalidOperation('This task changed. Review the latest version before saving.', 'STALE_REVISION')
        super().__init__(connection, verify)


class NativeWork:
    def __init__(self, profile):
        from hermes_cli import kanban_db, projects_db
        from plugins.kanban.dashboard import plugin_api
        self.kanban, self.projects, self.api = kanban_db, projects_db, plugin_api
        self.profile = profile

    @contextmanager
    def scoped(self):
        from hermes_constants import set_hermes_home_override, reset_hermes_home_override
        from hermes_cli.profiles import get_profile_dir
        token = set_hermes_home_override(get_profile_dir(self.profile))
        try:
            yield self
        finally:
            reset_hermes_home_override(token)

    @property
    def edit_details(self):
        return callable(getattr(self.kanban, 'edit_task', None))

    def list_projects(self):
        with self.projects.connect_closing() as conn:
            return [p.to_dict() for p in self.projects.list_projects(conn, include_archived=False)]

    def project(self, ident):
        with self.projects.connect_closing() as conn:
            project = self.projects.get_project(conn, ident)
            return project.to_dict() if project else None

    def create_project(self, slug, name, description):
        with self.projects.connect_closing() as conn:
            ident = self.projects.create_project(conn, name=name, slug=slug, folders=[], description=description)
            return self.projects.get_project(conn, ident).to_dict()

    def update_project(self, ident, **patch):
        with self.projects.connect_closing() as conn:
            self.projects.update_project(conn, ident, **patch)
            return self.projects.get_project(conn, ident).to_dict()

    def link_project(self, ident, slug):
        def verify(conn):
            project = self.projects.get_project(conn, ident)
            if project is None or project.board_slug not in (None, '', slug):
                raise InvalidOperation('This project was linked to another board', 'STALE_REVISION')
        with self.projects.connect_closing() as conn:
            self.projects.update_project(GuardedConnection(conn, verify), ident, board_slug=slug)

    def edit_project(self, ident, expected, patch):
        def verify(conn):
            project = self.projects.get_project(conn, ident)
            if project is None or fingerprint(project.to_dict()) != expected:
                raise InvalidOperation('This project changed. Review its latest instructions before saving.', 'STALE_REVISION')
        with self.projects.connect_closing() as conn:
            self.projects.update_project(GuardedConnection(conn, verify), ident, **patch)
            return self.projects.get_project(conn, ident).to_dict()

    def list_boards(self):
        return self.api.list_boards(include_archived=False)['boards']

    def create_board(self, slug, project):
        return self.api.create_board_endpoint(self.api.CreateBoardBody(slug=slug, name=project['name'],
            description=project.get('description') or '', project_id=project['id'], switch=False))['board']

    def board(self, slug):
        return self.api.get_board(tenant=None, include_archived=False, board=slug,
            workflow_template_id=None, current_step_key=None)

    def task(self, slug, ident):
        return self.api.get_task(ident, board=slug, run_state_type=None, run_state_name=None)

    def create_task(self, slug, spec, project, key):
        return self.api.create_task(self.api.CreateTaskBody(title=spec['title'], body=spec['body'],
            assignee=spec['assignee'], priority=spec['priority'], triage=True,
            project_id=project, idempotency_key=key), board=slug)['task']

    def edit_task(self, slug, ident, expected, patch):
        if not self.edit_details:
            raise InvalidOperation('This Hermes build supports viewing and creating tasks, but not safe task-detail edits.', 'UPDATE_REQUIRED')
        with closing(self.api._conn(board=slug)) as conn:
            checked = CheckedConnection(conn, ident, expected)
            if not self.kanban.edit_task(checked, ident, title=patch['title'], body=patch['body'], priority=patch['priority'], board=slug):
                raise InvalidOperation('The task could not be edited')
        return self.task(slug, ident)['task']

    def assign_task(self, slug, ident, expected, profile):
        with closing(self.api._conn(board=slug)) as conn:
            if not self.kanban.assign_task(CheckedConnection(conn, ident, expected), ident, profile):
                raise InvalidOperation('The assignee could not be saved')
        return self.task(slug, ident)['task']

    def comment(self, slug, ident, body, author):
        return self.api.add_comment(ident, self.api.CommentBody(body=body, author=author), board=slug)
