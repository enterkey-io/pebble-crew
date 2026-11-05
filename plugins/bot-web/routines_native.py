"""Profile-scoped native cron management; never runs a routine or a model."""
import json
from .operations import InvalidOperation, fields, identifier
from .work_store import fingerprint

CONFIG = ('name', 'prompt', 'schedule', 'deliver', 'enabled', 'skills', 'skill', 'model', 'provider', 'base_url', 'enabled_toolsets', 'continuity', 'repeat')


def validate_command(command):
    if not isinstance(command, dict):
        raise InvalidOperation('Choose a routine action')
    action = command.get('action')
    if action == 'list':
        fields(command, ['action', 'offset'] if 'offset' in command else ['action'])
        if type(command.get('offset', 0)) is not int or not 0 <= command.get('offset', 0) <= 10000:
            raise InvalidOperation('Choose a valid routine page')
    elif action == 'create':
        fields(command, ['action', 'name', 'prompt', 'schedule'])
    elif action == 'update':
        fields(command, ['action', 'job_id', 'expected', 'name', 'prompt', 'schedule'])
    elif isinstance(action, str) and action in {'pause', 'resume', 'remove'}:
        fields(command, ['action', 'job_id', 'expected'])
    else:
        raise InvalidOperation('Use list, create, update, pause, resume or remove; running a job is separate')
    for key, limit in [('name', 120), ('prompt', 12000), ('schedule', 200)]:
        if key in command and (not isinstance(command[key], str) or not 1 <= len(command[key].strip()) <= limit):
            raise InvalidOperation('Choose a routine name, instructions and schedule')
    if 'job_id' in command:
        identifier(command['job_id'])
        if not isinstance(command['expected'], str) or len(command['expected']) != 64:
            raise InvalidOperation('List routines first and use the current configuration revision')


def config_revision(job):
    return fingerprint({key: job.get(key) for key in CONFIG})


def manage(profile, command):
    from .proactive_native import NativeProactive
    from cron.jobs import get_job, list_jobs
    from tools.cronjob_tools import cronjob
    validate_command(command)
    native = NativeProactive(profile)
    with native.scoped():
        if command['action'] == 'list':
            jobs = list_jobs(include_disabled=True)
            offset = command.get('offset', 0)
            return {'success': True, 'jobs': [{**{key: job.get(key) for key in ('name', 'prompt', 'schedule', 'deliver', 'enabled')},
                'job_id': job['id'], 'revision': config_revision(job)} for job in jobs[offset:offset+5]],
                'next_offset': offset+5 if len(jobs) > offset+5 else None, 'count': len(jobs)}
        if command['action'] != 'create':
            job = get_job(command['job_id'])
            if not job or config_revision(job) != command['expected']:
                return {'success': False, 'code': 'STALE_REVISION'}
        params = {k: v for k, v in command.items() if k != 'expected'}
        if command['action'] == 'create':
            params['deliver'] = 'bot-chat'
        result = json.loads(cronjob(**params))
        if result.get('success') is not True:
            return {'success': False, 'code': 'ROUTINE_REJECTED'}
        # Keep receipts small and omit native diagnostics, credentials and unrelated configuration.
        return {'success': True, 'job_id': result.get('job_id') or command.get('job_id'), 'action': command['action']}


def register():
    from tui_gateway import server
    def invoke(rid, params):
        try:
            fields(params, ['profile', 'command'])
            from hermes_cli.profiles import list_profiles
            if params['profile'] not in {row.name for row in list_profiles()}:
                raise ValueError()
            return server._ok(rid, manage(params['profile'], params['command']))
        except InvalidOperation as error:
            return server._ok(rid, {'success': False, 'code': error.code})
        except Exception:
            return server._err(rid, 5079, 'Routine management was not confirmed')
    server.method('bot_web.routines')(invoke)
