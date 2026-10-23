import { CrewFaces } from './CrewFaces';
import { DiscardChanges } from './DiscardChanges';
import { Form } from '../components/ui/form';
import { useEffect, useState } from 'react';
import type { Dispatch, DragEvent, ReactNode, SetStateAction } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronDown, Pin, Plus, SlidersHorizontal, Flag, CornerUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NavigationItem } from './NavigationItem';
import { UnreadDot } from './UnreadDot';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { safeError } from '@hermes-client/core';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  removeCrew,
  isSystemSection,
  sectionAccepts,
  sectionChoiceLabel,
  removeSection,
  nudgeItem,
  nudgeSection,
  placeCrew,
  placePebble,
  placementOf,
  readRailDrag,
  reorderSection,
  railDropTarget,
  setCrewMembers,
  hasShortcut,
  addShortcut,
  removeShortcut,
  crewMembers,
} from './organization';
import type {
  Organization,
  OrganizationEditor,
  Placement,
  RailDrag,
  RailDrop,
  RailDropZone,
} from './organization';
import { useOverlayHistory } from './overlay-history';
import { ContextActions } from './primitives';
import type { MenuItem } from './primitives';

type RailPebble = {
  id: string;
  name: string;
  title: string;
  preview: string;
  pinned: boolean;
  unread?: boolean;
};
type ChangeOrganization = Dispatch<SetStateAction<Organization>>;
const dragFormat = 'application/x-pebble-crew-rail';
function drag(event: DragEvent, item: RailDrag) {
  event.stopPropagation();
  event.dataTransfer.setData(dragFormat, JSON.stringify(item));
  event.dataTransfer.effectAllowed = 'move';
}
function allow(event: DragEvent) {
  if (event.dataTransfer.types.includes(dragFormat)) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
  }
}

export function pebblePlacementItems(
  org: Organization,
  id: string,
  onChange: ChangeOrganization,
  onCreate: (editor: OrganizationEditor) => void,
): MenuItem[] {
  const value = placementOf(org, id);
  const sections = org.sections.filter(
    (section) =>
      sectionAccepts(section.id, 'pebble') &&
      (section.id !== 'pebbles' ||
        value?.kind !== 'section' ||
        value.id !== 'pebbles' ||
        org.sections.some((s) => !isSystemSection(s.id))),
  );
  const member = org.crews.some((c) => c.members.includes(id));
  return [
    ...(member
      ? [
          {
            label: hasShortcut(org, id) ? 'Remove shortcut' : 'Add shortcut',
            icon: CornerUpRight,
            action: () =>
              onChange((current) =>
                hasShortcut(current, id) ? removeShortcut(current, id) : addShortcut(current, id),
              ),
          },
        ]
      : []),
    {
      label: 'Move to section',
      action: () => {},
      items: [
        ...sections.map((section) => ({
          label: sectionChoiceLabel(section),
          checked: value?.kind === 'section' && value.id === section.id,
          action: () =>
            onChange((current) => placePebble(current, id, { kind: 'section', id: section.id })),
        })),
        {
          label: 'New section',
          icon: Plus,
          separatorBefore: !!sections.length,
          action: () => onCreate({ kind: 'new-section', item: { kind: 'pebble', id } }),
        },
      ],
    },
    {
      label: 'Move to crew',
      action: () => {},
      items: [
        ...org.crews.map((crew) => ({
          label: crew.name,
          checked: crew.members.includes(id),
          action: () =>
            onChange((current) => placePebble(current, id, { kind: 'crew', id: crew.id })),
        })),
        {
          label: 'New crew',
          icon: Plus,
          separatorBefore: !!org.crews.length,
          action: () => onCreate({ kind: 'new-crew', pebbleId: id }),
        },
      ],
    },
  ];
}

function PebbleActions({
  pebble,
  onPin,
  onEdit,
  org,
  onChange,
  onCreate,
  children,
}: {
  pebble: RailPebble;
  onPin: () => void;
  onEdit: () => void;
  org: Organization;
  onChange: ChangeOrganization;
  onCreate: (editor: OrganizationEditor) => void;
  children: ReactNode;
}) {
  return (
    <ContextActions
      label={`Actions for ${pebble.name}`}
      items={[
        { label: pebble.pinned ? 'Unpin' : 'Pin', icon: Pin, action: onPin },
        { label: 'Edit pebble', icon: SlidersHorizontal, action: onEdit },
        ...pebblePlacementItems(org, pebble.id, onChange, onCreate),
      ]}
    >
      {children}
    </ContextActions>
  );
}

export function OrganizationRail({
  org,
  onChange,
  pebbles,
  activeId,
  face,
  onOpenPebble,
  onOpenCrew,
  onEditPebble,
  onEditOrganization,
  onPin,
  actions,
  openLabel,
}: {
  actions?: (id: string, children: ReactNode) => ReactNode;
  openLabel?: (pebble: RailPebble) => string;
  org: Organization;
  onChange: ChangeOrganization;
  pebbles: RailPebble[];
  activeId: string;
  face: (id: string, large?: boolean, animated?: boolean) => ReactNode;
  onOpenPebble: (id: string) => void;
  onOpenCrew: (id: string) => void;
  onEditPebble: (id: string) => void;
  onEditOrganization: (editor: OrganizationEditor) => void;
  onPin: (id: string) => void;
}) {
  const reduced = useReducedMotion();
  const pinnedIds = pebbles.filter((p) => p.pinned).map((p) => p.id);
  const [over, setOver] = useState('');
  const [dragging, setDragging] = useState<RailDrag>();
  function startDrag(event: DragEvent, item: RailDrag) {
    drag(event, item);
    setDragging(item);
    if (item.kind === 'crew') {
      const bounds = event.currentTarget.getBoundingClientRect();
      event.dataTransfer.setDragImage(
        event.currentTarget,
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      );
    }
  }
  function endDrag() {
    setOver('');
    setDragging(undefined);
  }
  const move = { duration: reduced ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] as const };
  function dropped(event: DragEvent, { target, beforeId }: RailDrop) {
    event.preventDefault();
    event.stopPropagation();
    endDrag();
    const item = readRailDrag(
      event.dataTransfer.getData(dragFormat),
      org,
      pebbles.map((p) => p.id),
    );
    if (!item) return;
    if (item.kind === 'section' && target.kind === 'section' && target.id === 'pebbles') return;
    if (
      item.kind === 'pebble' &&
      pinnedIds.includes(item.id) &&
      !item.placement &&
      (target.kind !== 'section' || sectionAccepts(target.id, 'pebble'))
    )
      onPin(item.id);
    onChange((current) => {
      if (item.kind === 'section')
        return target.kind === 'section' ? reorderSection(current, item.id, beforeId) : current;
      if (item.kind === 'pebble') {
        let next = current;
        if (item.placement?.kind === 'crew' && target.kind === 'section') {
          const source = current.crews.find((c) => c.id === item.placement?.id);
          if (source)
            next = setCrewMembers(
              current,
              source.id,
              source.members.filter((id) => id !== item.id),
            );
        }
        return placePebble(next, item.id, target, beforeId);
      }
      const section =
        target.kind === 'section'
          ? current.sections.find((s) => s.id === target.id)
          : current.sections.find((s) =>
              s.items.some((row) => row.kind === 'crew' && row.id === target.id),
            );
      return section
        ? placeCrew(current, item.id, section.id, target.kind === 'crew' ? target.id : beforeId)
        : current;
    });
  }
  function targetEvents(zone: RailDropZone) {
    const key =
      zone.kind === 'section' ? `section:${zone.id}` : `${zone.item.kind}:${zone.item.id}`;
    const resolve = (event: DragEvent, kind: RailDrag['kind']) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      return railDropTarget(org, kind, zone, event.clientY > bounds.top + bounds.height / 2);
    };
    return {
      onDragOver: (event: DragEvent) => {
        if (!event.dataTransfer.types.includes(dragFormat)) return;
        if (isSource(dragging)) {
          allow(event);
          setOver('');
          return;
        }
        const destination = resolve(event, dragging?.kind ?? 'pebble');
        if (!destination) return;
        allow(event);
        setOver(`${key}:${destination.edge}`);
      },
      onDragLeave: (event: DragEvent) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOver((current) => (current.startsWith(`${key}:`) ? '' : current));
      },
      onDrop: (event: DragEvent) => {
        const item = readRailDrag(
          event.dataTransfer.getData(dragFormat),
          org,
          pebbles.map((p) => p.id),
        );
        if (!item) return;
        if (isSource(item)) {
          event.preventDefault();
          event.stopPropagation();
          endDrag();
          return;
        }
        const destination = resolve(event, item.kind);
        if (destination) dropped(event, destination);
      },
      'data-drop-target': over.startsWith(`${key}:`) || undefined,
      'data-drop-edge': over.startsWith(`${key}:`) ? over.slice(key.length + 1) : undefined,
    };
    function isSource(item: RailDrag | undefined) {
      return (
        item &&
        (zone.kind === 'item'
          ? item.kind === zone.item.kind &&
            item.id === zone.item.id &&
            (item.kind !== 'pebble' ||
              !item.placement ||
              (item.placement.kind === zone.placement.kind &&
                item.placement.id === zone.placement.id))
          : item.kind === 'section' && item.id === zone.id)
      );
    }
  }
  function row(id: string, target: Placement) {
    const pebble = pebbles.find((p) => p.id === id);
    if (
      !pebble ||
      (pebble.pinned && target.kind === 'section' && !org.crews.some((c) => c.members.includes(id)))
    )
      return null;
    const compact = target.kind === 'crew';
    const manager = compact && org.crews.some((c) => c.id === target.id && c.managerId === id);
    const content = (
      <motion.div
        layout="position"
        layoutId={
          target.kind === 'section' && !org.crews.some((c) => c.members.includes(id))
            ? `pebble-${id}`
            : `pebble-${target.kind}-${target.id}-${id}`
        }
        onKeyDown={(event) => {
          if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            onChange((current) =>
              nudgeItem(
                current,
                { kind: 'pebble', id },
                event.key === 'ArrowUp' ? -1 : 1,
                pinnedIds,
                target,
              ),
            );
          }
        }}
        transition={move}
        key={id}
        className={`pc-row pebble-row ${compact ? 'pc-crew-member' : ''} ${activeId === id ? 'is-selected' : ''}`}
        data-unread={pebble.unread || undefined}
        draggable
        onDragStartCapture={(event) => startDrag(event, { kind: 'pebble', id, placement: target })}
        onDragEnd={endDrag}
        {...targetEvents({ kind: 'item', item: { kind: 'pebble', id }, placement: target })}
      >
        <NavigationItem
          density={compact ? 'compact' : 'normal'}
          media={
            <span className={`pc-member-face ${compact ? 'is-compact' : ''}`}>
              {face(id)}
              {manager && (
                <span className="pc-crew-manager" role="img" aria-label="Crew manager">
                  <Flag aria-hidden="true" />
                </span>
              )}
            </span>
          }
          title={pebble.name}
          label={pebble.title}
          description={compact ? undefined : <span aria-hidden="true">{pebble.preview}</span>}
          onClick={() => onOpenPebble(id)}
          aria-label={
            openLabel?.(pebble) ?? `Open ${pebble.name} ${pebble.title} ${pebble.preview}`
          }
        />
        {pebble.unread && <UnreadDot />}
      </motion.div>
    );
    return actions ? (
      actions(id, content)
    ) : (
      <PebbleActions
        pebble={pebble}
        onPin={() => onPin(id)}
        onEdit={() => onEditPebble(id)}
        org={org}
        onChange={onChange}
        onCreate={onEditOrganization}
      >
        {content}
      </PebbleActions>
    );
  }
  function crewRow(id: string, sectionId: string) {
    const crew = org.crews.find((c) => c.id === id);
    if (!crew) return null;
    const sections = org.sections.filter((section) => sectionAccepts(section.id, 'crew'));
    return (
      <ContextActions
        key={id}
        label={`Actions for ${crew.name}`}
        items={[
          {
            label: 'Crew settings',
            icon: SlidersHorizontal,
            action: () => onEditOrganization({ kind: 'edit-crew', id }),
          },
          {
            label: 'Move to section',
            action: () => {},
            items: [
              ...sections.map((section) => ({
                label: sectionChoiceLabel(section),
                checked: section.id === sectionId,
                action: () => onChange((current) => placeCrew(current, id, section.id)),
              })),
              {
                label: 'New section',
                icon: Plus,
                separatorBefore: !!sections.length,
                action: () =>
                  onEditOrganization({ kind: 'new-section', item: { kind: 'crew', id } }),
              },
            ],
          },
        ]}
      >
        <motion.div
          layout
          transition={move}
          className="pc-crew-group"
          data-crew-id={id}
          draggable
          onDragStartCapture={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest('[draggable=true]') === event.currentTarget
            )
              startDrag(event, { kind: 'crew', id });
          }}
          onDragEnd={endDrag}
          data-dragging={(dragging?.kind === 'crew' && dragging.id === id) || undefined}
          onKeyDown={(event) => {
            if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
              event.preventDefault();
              event.stopPropagation();
              onChange((current) =>
                nudgeItem(
                  current,
                  { kind: 'crew', id },
                  event.key === 'ArrowUp' ? -1 : 1,
                  pinnedIds,
                ),
              );
            }
          }}
          {...targetEvents({
            kind: 'item',
            item: { kind: 'crew', id },
            placement: { kind: 'section', id: sectionId },
          })}
        >
          <div className={`pc-row pc-crew-row ${activeId === id ? 'is-selected' : ''}`}>
            <Button
              variant="quiet"
              size="icon-sm"
              className="pc-crew-toggle"
              aria-label={`${crew.collapsed ? 'Expand' : 'Collapse'} ${crew.name} pebbles`}
              aria-expanded={!crew.collapsed}
              aria-controls={`crew-members-${id}`}
              onClick={() =>
                onChange((current) => ({
                  ...current,
                  crews: current.crews.map((c) =>
                    c.id === id ? { ...c, collapsed: !c.collapsed } : c,
                  ),
                }))
              }
            >
              <ChevronDown data-collapsed={crew.collapsed} />
            </Button>
            <NavigationItem
              className="pc-crew"
              title={crew.name}
              description={`${crew.members.length} pebbles`}
              aria-label={`${crew.name} ${crew.members.length} pebbles. Open chat`}
              onClick={() => onOpenCrew(id)}
              media={
                <CrewFaces
                  members={crewMembers(crew)}
                  face={(id, animated) => face(id, false, animated)}
                />
              }
            />
          </div>
          <AnimatePresence initial={false}>
            {!crew.collapsed && (
              <motion.div
                id={`crew-members-${id}`}
                initial={{ height: 0 }}
                animate={{ height: 'auto' }}
                exit={{ height: 0 }}
                transition={move}
                style={{ overflow: 'hidden' }}
                className="pc-crew-members"
                aria-label={`${crew.name} pebbles`}
              >
                {crewMembers(crew).map((member) => row(member, { kind: 'crew', id }))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </ContextActions>
    );
  }
  return (
    <>
      {org.sections
        .filter((section) => section.id === 'pebbles')
        .map((section) => (
          <motion.div
            layout
            transition={move}
            key={section.id}
            className="pc-unsectioned"
            role="group"
            aria-label="Unsectioned pebbles"
            {...targetEvents({ kind: 'section', id: section.id })}
          >
            {section.items.map((item) =>
              item.kind === 'pebble'
                ? row(item.id, { kind: 'section', id: section.id })
                : crewRow(item.id, section.id),
            )}
          </motion.div>
        ))}
      {org.sections
        .filter(
          (section) =>
            section.id !== 'pebbles' &&
            (!isSystemSection(section.id) ||
              section.items.some((item) =>
                item.kind === 'crew'
                  ? org.crews.some((c) => c.id === item.id)
                  : pebbles.some((p) => p.id === item.id && !p.pinned),
              )),
        )
        .map((section) => (
          <motion.section
            layout
            transition={move}
            key={section.id}
            className="pc-list"
            aria-label={section.name}
            {...targetEvents({ kind: 'section', id: section.id })}
          >
            <ContextActions
              label={`Actions for ${section.name} section`}
              items={
                isSystemSection(section.id)
                  ? []
                  : [
                      {
                        label: 'Rename section',
                        action: () => onEditOrganization({ kind: 'edit-section', id: section.id }),
                      },
                    ]
              }
            >
              <div
                className="pc-section-header"
                draggable
                onDragStart={(event) => startDrag(event, { kind: 'section', id: section.id })}
                onDragEnd={endDrag}
                onKeyDown={(event) => {
                  if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
                    event.preventDefault();
                    onChange((current) =>
                      nudgeSection(current, section.id, event.key === 'ArrowUp' ? -1 : 1),
                    );
                  }
                }}
              >
                <Button
                  variant="quiet"
                  className="pc-section-toggle"
                  aria-expanded={!section.collapsed}
                  onClick={() =>
                    onChange((current) => ({
                      ...current,
                      sections: current.sections.map((s) =>
                        s.id === section.id ? { ...s, collapsed: !s.collapsed } : s,
                      ),
                    }))
                  }
                >
                  <ChevronDown data-collapsed={section.collapsed} />
                  <span>{section.name}</span>
                </Button>
              </div>
            </ContextActions>
            <AnimatePresence initial={false}>
              {!section.collapsed && (
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: 'auto' }}
                  exit={{ height: 0 }}
                  transition={move}
                  style={{ overflow: 'hidden' }}
                  className="pc-section-items"
                >
                  {section.items.map((item) =>
                    item.kind === 'pebble'
                      ? row(item.id, { kind: 'section', id: section.id })
                      : crewRow(item.id, section.id),
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        ))}
    </>
  );
}

export function OrganizationDialog({
  editor,
  org,
  pebbles,
  face,
  onCreateGroup,
  onChange,
  onClose,
}: {
  editor: OrganizationEditor | null;
  org: Organization;
  pebbles: { id: string; name: string; handle: string }[];
  face: (id: string) => ReactNode;
  onCreateGroup: (value: { id: string; name: string; members: string[] }) => Promise<void>;
  onChange: ChangeOrganization;
  onClose: () => void;
}) {
  const [name, setName] = useState(''),
    [purpose, setPurpose] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [managerId, setManagerId] = useState<string | null>(null);
  const [original, setOriginal] = useState<{
    name: string;
    purpose: string;
    members: string[];
    managerId: string | null;
  }>({
    name: '',
    purpose: '',
    members: [],
    managerId: null,
  });
  const [discard, setDiscard] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [creationId, setCreationId] = useState('');
  const isCrew = editor?.kind === 'new-crew' || editor?.kind === 'edit-crew';
  const isGroup = editor?.kind === 'new-group-chat';
  function requestClose() {
    if (pending) return false;
    if (
      managerId !== original.managerId ||
      name !== original.name ||
      purpose !== original.purpose ||
      JSON.stringify(members) !== JSON.stringify(original.members)
    ) {
      setDiscard(true);
      return false;
    }
    onClose();
    return true;
  }
  useOverlayHistory(!!editor, requestClose);
  useOverlayHistory(discard, () => setDiscard(false));
  useEffect(() => {
    if (!editor) return;
    const entity =
      editor.kind === 'edit-crew'
        ? org.crews.find((c) => c.id === editor.id)
        : editor.kind === 'edit-section'
          ? org.sections.find((s) => s.id === editor.id)
          : undefined;
    setName(entity?.name ?? '');
    setPurpose(entity && 'purpose' in entity ? entity.purpose : '');
    const initialMembers =
      entity && 'members' in entity
        ? entity.members
        : editor.kind === 'new-crew' && editor.pebbleId
          ? [editor.pebbleId]
          : [];
    setMembers(initialMembers);
    const manager = entity && 'managerId' in entity ? entity.managerId : null;
    setManagerId(manager);
    setOriginal({
      name: entity?.name ?? '',
      purpose: entity && 'purpose' in entity ? entity.purpose : '',
      members: initialMembers,
      managerId: manager,
    });
    setDiscard(false);
    setPending(false);
    setError('');
    setCreationId(crypto.randomUUID());
  }, [editor]);
  async function save() {
    if (
      !editor ||
      pending ||
      !name.trim() ||
      ((isCrew || isGroup) && (members.length < 2 || members.length > 6))
    )
      return;
    const id = creationId;
    if (editor.kind === 'new-group-chat') {
      setPending(true);
      setError('');
      try {
        await onCreateGroup({ id: 'group-' + id, name: name.trim(), members });
        onClose();
      } catch (error) {
        setError(safeError(error).message);
      } finally {
        setPending(false);
      }
      return;
    }
    onChange((current) => {
      switch (editor.kind) {
        case 'new-section': {
          const next = {
            ...current,
            sections: [...current.sections, { id, name: name.trim(), collapsed: false, items: [] }],
          };
          return editor.item?.kind === 'crew'
            ? placeCrew(next, editor.item.id, id)
            : editor.item?.kind === 'pebble'
              ? placePebble(next, editor.item.id, { kind: 'section', id })
              : next;
        }
        case 'edit-section':
          return {
            ...current,
            sections: current.sections.map((s) =>
              s.id === editor.id ? { ...s, name: name.trim() } : s,
            ),
          };
        case 'new-crew':
          return setCrewMembers(
            {
              ...current,
              crews: [
                ...current.crews,
                { id, name: name.trim(), purpose, managerId, collapsed: false, members: [] },
              ],
              sections: current.sections.map((s) =>
                s.id === 'pebbles' ? { ...s, items: [...s.items, { kind: 'crew', id }] } : s,
              ),
            },
            id,
            members,
          );
        case 'edit-crew':
          return setCrewMembers(
            {
              ...current,
              crews: current.crews.map((c) =>
                c.id === editor.id ? { ...c, name: name.trim(), purpose, managerId } : c,
              ),
            },
            editor.id,
            members,
          );
      }
    });
    onClose();
  }
  const title =
    editor?.kind === 'edit-crew'
      ? 'Crew settings'
      : editor?.kind === 'edit-section'
        ? 'Rename section'
        : isGroup
          ? 'New group chat'
          : isCrew
            ? 'New crew'
            : 'New section';
  return (
    <Dialog
      open={!!editor}
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        size="content"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.querySelector<HTMLElement>('[aria-label="New"]')?.focus();
        }}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Organize your sidebar. Agent profiles and chat history stay intact.
          </DialogDescription>
        </DialogHeader>
        <Form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="flex min-h-0 flex-col gap-4"
        >
          <div className="grid min-h-0 gap-4 overflow-y-auto px-1 pb-1">
            <div className="grid gap-2">
              <Label htmlFor="organization-name">Name</Label>
              <Input
                id="organization-name"
                value={name}
                disabled={pending}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
              />
            </div>
            {isCrew && (
              <div className="grid gap-2">
                <Label htmlFor="organization-purpose">Purpose</Label>
                <Textarea
                  id="organization-purpose"
                  rows={3}
                  value={purpose}
                  maxLength={2000}
                  onChange={(event) => setPurpose(event.target.value)}
                />
              </div>
            )}
            {isCrew && (
              <div className="grid gap-2">
                <Label htmlFor="crew-manager">Crew manager</Label>
                <Select
                  value={managerId ?? 'none'}
                  onValueChange={(value) => setManagerId(value === 'none' ? null : value)}
                >
                  <SelectTrigger id="crew-manager">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {pebbles
                      .filter((p) => members.includes(p.id))
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {(isCrew || isGroup) && (
              <fieldset className="min-w-0">
                <legend className="mb-2 text-sm font-medium">
                  Pebbles <span className="font-normal text-muted-foreground">(2–6)</span>
                </legend>
                <div
                  className="grid max-h-56 gap-1 overflow-y-auto"
                  aria-label={isGroup ? 'Group members' : 'Crew members'}
                >
                  {pebbles.map((pebble) => (
                    <Label
                      key={pebble.id}
                      className="relative flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        checked={members.includes(pebble.id)}
                        disabled={pending || (!members.includes(pebble.id) && members.length >= 6)}
                        onCheckedChange={(checked) => {
                          if (checked !== true && managerId === pebble.id) setManagerId(null);
                          setMembers((current) =>
                            checked === true
                              ? [...current, pebble.id]
                              : current.filter((id) => id !== pebble.id),
                          );
                        }}
                        aria-label={pebble.name}
                      />
                      <span aria-hidden="true" className="shrink-0 [&_.agent-avatar]:size-7">
                        {face(pebble.id)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{pebble.name}</span>
                      <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
                        @{pebble.handle}
                      </span>
                    </Label>
                  ))}
                  {!pebbles.length && (
                    <p className="text-sm text-muted-foreground">
                      Add pebbles before creating a crew.
                    </p>
                  )}
                </div>
              </fieldset>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="shrink-0">
            {editor?.kind === 'edit-crew' && (
              <Button
                type="button"
                variant="destructive-ghost"
                className="self-start sm:mr-auto"
                onClick={() => {
                  onChange((current) => removeCrew(current, editor.id));
                  onClose();
                }}
              >
                Remove crew
              </Button>
            )}
            {editor?.kind === 'edit-section' &&
              !isSystemSection(editor.id) &&
              org.sections.length > 1 && (
                <Button
                  type="button"
                  variant="destructive-ghost"
                  className="self-start sm:mr-auto"
                  onClick={() => {
                    onChange((current) => removeSection(current, editor.id));
                    onClose();
                  }}
                >
                  Remove section
                </Button>
              )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button
                disabled={
                  pending ||
                  !name.trim() ||
                  ((isCrew || isGroup) && (members.length < 2 || members.length > 6))
                }
                type="submit"
              >
                {editor?.kind.startsWith('new') ? 'Create' : 'Save changes'}
              </Button>
            </div>
          </DialogFooter>
        </Form>
        <DiscardChanges
          open={discard}
          onOpenChange={setDiscard}
          onDiscard={() => {
            setDiscard(false);
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
