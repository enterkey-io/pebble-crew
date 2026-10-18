const phases = document.querySelector('#phases');
const tasks = document.querySelector('#tasks');
const transport = document.querySelector('#transport');
let state;
let selected;
let following = true;
const phaseNodes = new Map();
const taskNodes = new Map();
const labels = {
  todo: 'Planned',
  doing: 'In progress',
  done: 'Complete',
  waiting: 'Waiting on you',
  blocked: 'Blocked',
};
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function currentIndex() {
  return state.phases.findIndex((phase) => phase.tasks.some((task) => task.status !== 'done'));
}
function choose(id) {
  const index = currentIndex();
  following = id === state.phases[index < 0 ? state.phases.length - 1 : index].id;
  selected = id;
  taskNodes.clear();
  tasks.replaceChildren();
  render();
}
function render() {
  const current = currentIndex();
  const all = state.phases.flatMap((phase) => phase.tasks);
  const complete = all.filter((task) => task.status === 'done').length;
  document.querySelector('#count').textContent = `${complete} of ${all.length} tasks complete`;
  const progress = document.querySelector('#progress');
  progress.max = all.length;
  progress.value = complete;
  const time = document.querySelector('#updated');
  time.dateTime = state.updatedAt;
  time.textContent = `Updated ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(new Date(state.updatedAt))} CT`;
  const waiting = document.querySelector('#waiting');
  waiting.hidden = !state.waiting;
  document.querySelector('#question').textContent = state.waiting?.question ?? '';
  const activeId = state.phases[current < 0 ? state.phases.length - 1 : current].id;
  if (!selected || (following && selected !== activeId)) {
    selected = activeId;
    taskNodes.clear();
    tasks.replaceChildren();
  }
  state.phases.forEach((phase, index) => {
    let button = phaseNodes.get(phase.id);
    if (!button) {
      button = element('button', 'phase');
      button.type = 'button';
      button.append(element('span', 'phase-name', phase.title), element('span', 'phase-state'));
      button.addEventListener('click', () => choose(phase.id));
      phases.append(button);
      phaseNodes.set(phase.id, button);
    }
    const done = phase.tasks.every((task) => task.status === 'done');
    const needsOwner = phase.tasks.some((task) => task.status === 'waiting');
    const value = done
      ? 'done'
      : needsOwner
        ? 'waiting'
        : index === current
          ? 'current'
          : index === current + 1
            ? 'next'
            : 'planned';
    button.dataset.state = value;
    button.setAttribute('aria-pressed', String(selected === phase.id));
    button.querySelector('.phase-state').textContent = {
      done: '✓ Complete',
      waiting: 'Waiting on you',
      current: 'Current',
      next: 'Next',
      planned: 'Planned',
    }[value];
  });
  const phase = state.phases.find((item) => item.id === selected);
  document.querySelector('#phase-title').textContent = phase.title;
  document.querySelector('#phase-count').textContent =
    `${phase.tasks.filter((task) => task.status === 'done').length} / ${phase.tasks.length}`;
  const next = phase.tasks.find((task) => task.status === 'todo')?.id;
  phase.tasks.forEach((task) => {
    let row = taskNodes.get(task.id);
    if (!row) {
      row = element('li', 'task');
      row.dataset.task = task.id;
      const copy = element('div', 'task-copy');
      copy.append(element('p', 'task-title', task.title), element('p', 'task-note'));
      row.append(element('span', 'task-marker'), copy, element('span', 'task-state'));
      row.querySelector('.task-marker').setAttribute('aria-hidden', 'true');
      tasks.append(row);
      taskNodes.set(task.id, row);
    }
    row.dataset.state = task.status;
    row.querySelector('.task-marker').textContent =
      task.status === 'done' ? '✓' : ['waiting', 'blocked'].includes(task.status) ? '!' : '';
    row.querySelector('.task-note').textContent = task.note ?? '';
    row.querySelector('.task-state').textContent =
      task.status === 'todo' && task.id === next ? 'Next' : labels[task.status];
  });
}
const stream = new EventSource('/events');
stream.onopen = () => {
  transport.dataset.live = 'true';
  transport.querySelector('span').textContent = 'Live';
};
stream.onerror = () => {
  transport.dataset.live = 'false';
  transport.querySelector('span').textContent = 'Reconnecting';
};
stream.addEventListener('state', (event) => {
  const update = JSON.parse(event.data);
  if (state && update.revision <= state.revision) return;
  const initial = !state;
  state = update;
  render();
  if (initial) phaseNodes.get(selected)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  document.querySelector('#announcement').textContent = state.waiting
    ? `Waiting on you. ${state.waiting.question}`
    : 'Progress updated.';
});
