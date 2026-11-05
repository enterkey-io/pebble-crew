"""Retired department writer. Old callers cannot reinterpret section membership."""
from .operations import InvalidOperation


async def invoke(*_args, **_kwargs):
    raise InvalidOperation('Crews were replaced by sections and explicit group chats', 'UPDATE_REQUIRED')
