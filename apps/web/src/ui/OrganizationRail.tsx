import { Fragment, useEffect, useRef, useState } from 'react';
import type { Dispatch, DragEvent, ReactNode, SetStateAction } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronDown, CornerUpRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Form } from '@/components/ui/form';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { safeError } from '@hermes-client/core';
import { NavigationItem } from './NavigationItem';
import { UnreadDot } from './UnreadDot';
import { ContextActions } from './primitives';
import type { MenuItem } from './primitives';
import { DiscardChanges } from './DiscardChanges';
import { useOverlayHistory } from './overlay-history';
import {
  addShortcut,
  hasShortcut,
  isSystemSection,
  moveSection,
  nudgeItem,
  nudgeSection,
  placeItem,
  placePebble,
  placementOf,
  readRailDrag,
  removeSection,
  removeShortcut,
  sectionChoiceLabel,
} from './organization';
import type { Organization, OrganizationEditor, RailDrag, RailItem } from './organization';

type ChangeOrganization = Dispatch<SetStateAction<Organization>>;
type RailPebble = {
  id: string;
  name: string;
  title: string;
  preview: string;
  pinned: boolean;
  activity: number;
  unread?: boolean;
};
export type RailGroup = {
  id: string;
  readKey: string;
  name: string;
  preview: string;
  unread: boolean;
  activity: number;
};
const dragFormat = 'application/x-pebble-crew-rail';

export function pebblePlacementItems(
  org: Organization,
  id: string,
  onChange: ChangeOrganization,
  onCreate: (editor: OrganizationEditor) => void,
  placementId?: string,
): MenuItem[] {
  const value = placementId
    ? org.sections.find((s) => s.items.some((i) => i.placementId === placementId))
    : placementOf(org, id);
  const sections = org.sections.filter(
    (s) => !isSystemSection(s.id) || value?.id !== s.id || org.sections.length > 1,
  );
  return [
    {
      label: hasShortcut(org, id) ? 'Remove shortcut' : 'Add shortcut',
      icon: CornerUpRight,
      action: () => {
        const reference = crypto.randomUUID();
        onChange((current) =>
          hasShortcut(current, id)
            ? removeShortcut(current, id)
            : addShortcut(current, id, reference),
        );
      },
    },
    {
      label: 'Move to section',
      action: () => {},
      items: [
        ...sections.map((section) => ({
          label: sectionChoiceLabel(section),
          checked: value?.id === section.id,
          action: () =>
            onChange((current) =>
              placementId
                ? placeItem(current, placementId, section.id)
                : placePebble(current, id, { kind: 'section', id: section.id }),
            ),
        })),
        {
          label: 'New section',
          icon: Plus,
          separatorBefore: !!sections.length,
          action: () =>
            onCreate({
              kind: 'new-section',
              ...(placementId ? { placementId } : { pebbleId: id }),
            }),
        },
      ],
    },
  ];
}

export function OrganizationRail({
  org,
  onChange,
  pebbles,
  groups,
  activeId,
  face,
  groupFace,
  onOpenPebble,
  onOpenGroup,
  onDeleteGroup,
  onEditOrganization,
  onPin,
  actions,
  openLabel,
}: {
  org: Organization;
  onChange: ChangeOrganization;
  pebbles: RailPebble[];
  groups: RailGroup[];
  activeId: string;
  face: (id: string, large?: boolean, animated?: boolean) => ReactNode;
  groupFace: (id: string, readKey: string) => ReactNode;
  onOpenPebble: (id: string) => void;
  onOpenGroup: (id: string, readKey: string) => void;
  onDeleteGroup?: ((group: RailGroup) => void) | undefined;
  onEditOrganization: (editor: OrganizationEditor) => void;
  onPin: (id: string) => void;
  actions: (id: string, children: ReactNode, placementId?: string) => ReactNode;
  openLabel?: (pebble: RailPebble) => string;
}) {
  const reduced = useReducedMotion(),
    [dragging, setDragging] = useState<RailDrag>(),
    [over, setOver] = useState('');
  const pinned = pebbles.filter((p) => p.pinned).map((p) => p.id);
  const move = { duration: reduced ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] as const };
  const endDrag = () => {
    setDragging(undefined);
    setOver('');
  };
  const startDrag = (event: DragEvent, item: RailDrag) => {
    if (event.currentTarget.hasAttribute('data-stationary-press')) return;
    event.stopPropagation();
    event.dataTransfer.setData(dragFormat, JSON.stringify(item));
    event.dataTransfer.effectAllowed = 'move';
    setDragging(item);
  };
  function targetEvents(sectionId: string, row?: RailItem) {
    const key = row?.placementId ?? sectionId;
    return {
      onDragOver: (event: DragEvent) => {
        if (!event.dataTransfer.types.includes(dragFormat) || (dragging?.kind === 'section' && row))
          return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        const box = event.currentTarget.getBoundingClientRect();
        setOver(
          `${key}:${row ? (event.clientY > box.top + box.height / 2 ? 'after' : 'before') : 'inside'}`,
        );
      },
      onDragLeave: (event: DragEvent) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOver((value) => (value.startsWith(`${key}:`) ? '' : value));
      },
      onDrop: (event: DragEvent) => {
        if (dragging?.kind === 'section' && row) return;
        event.preventDefault();
        event.stopPropagation();
        const item = readRailDrag(
          event.dataTransfer.getData(dragFormat),
          org,
          pebbles.map((p) => p.id),
        );
        const box = event.currentTarget.getBoundingClientRect(),
          after = event.clientY > box.top + box.height / 2;
        endDrag();
        if (!item) return;
        if (item.kind === 'section') {
          const index = org.sections.findIndex((s) => s.id === sectionId);
          onChange((current) =>
            moveSection(current, item.id, after ? org.sections[index + 1]?.id : sectionId),
          );
          return;
        }
        const section = org.sections.find((s) => s.id === sectionId);
        const index = section?.items.findIndex((i) => i.placementId === row?.placementId) ?? -1;
        const before = row
          ? after
            ? section?.items[index + 1]?.placementId
            : row.placementId
          : undefined;
        if (item.kind === 'pebble') {
          if (pinned.includes(item.id)) onPin(item.id);
          onChange((current) =>
            placePebble(current, item.id, { kind: 'section', id: sectionId }, before),
          );
        } else onChange((current) => placeItem(current, item.id, sectionId, before));
      },
      'data-drop-target': over.startsWith(`${key}:`) || undefined,
      'data-drop-edge': over.startsWith(`${key}:`) ? over.slice(key.length + 1) : undefined,
    };
  }
  const pebbleActivity = new Map(pebbles.map((pebble) => [pebble.id, pebble.activity]));
  const groupActivity = new Map(groups.map((group) => [group.readKey, group.activity]));
  function activity(item: RailItem) {
    return (
      (item.kind === 'pebble' ? pebbleActivity.get(item.id) : groupActivity.get(item.readKey)) ?? 0
    );
  }
  function orderedRows(section: Organization['sections'][number]) {
    return section.items
      .toSorted((left, right) => activity(right) - activity(left))
      .map((item) => row(item, section.id));
  }
  function row(item: RailItem, sectionId: string) {
    const pebble = item.kind === 'pebble' ? pebbles.find((p) => p.id === item.id) : undefined;
    if (item.kind === 'pebble' && (!pebble || (pebble.pinned && !item.shortcut))) return null;
    const group =
      item.kind === 'group'
        ? groups.find((g) => g.id === item.id && g.readKey === item.readKey)
        : undefined;
    const content = (
      <motion.div
        key={item.placementId}
        layout="position"
        layoutId={
          item.kind === 'pebble' && !item.shortcut
            ? `pebble-${item.id}`
            : `placement-${item.placementId}`
        }
        transition={move}
        className={`pc-row ${item.kind === 'pebble' ? 'pebble-row' : 'group-row'} ${activeId === item.id ? 'is-selected' : ''}`}
        data-placement-id={item.placementId}
        data-dragging={
          (dragging?.kind === 'placement' && dragging.id === item.placementId) || undefined
        }
        draggable
        onDragStartCapture={(event) =>
          startDrag(event, { kind: 'placement', id: item.placementId })
        }
        onDragEnd={endDrag}
        onKeyDown={(event) => {
          if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            onChange((current) =>
              nudgeItem(current, item, event.key === 'ArrowUp' ? -1 : 1, pinned),
            );
          }
        }}
        {...targetEvents(sectionId, item)}
      >
        {item.kind === 'pebble' && pebble ? (
          <NavigationItem
            media={face(item.id)}
            title={pebble.name}
            label={pebble.title}
            description={<span aria-hidden="true">{pebble.preview}</span>}
            onClick={() => onOpenPebble(item.id)}
            aria-label={openLabel?.(pebble) ?? `Open ${pebble.name} ${pebble.title}`}
          />
        ) : item.kind === 'group' ? (
          <NavigationItem
            media={groupFace(item.id, item.readKey)}
            title={group?.name ?? 'Group chat'}
            description={group?.preview ?? 'Unavailable'}
            disabled={!group}
            onClick={() => onOpenGroup(item.id, item.readKey)}
            aria-label={`${group?.name ?? 'Group chat'} Open chat`}
          />
        ) : null}
        {(pebble?.unread || group?.unread) && <UnreadDot />}
      </motion.div>
    );
    if (item.kind === 'pebble')
      return (
        <Fragment key={item.placementId}>{actions(item.id, content, item.placementId)}</Fragment>
      );
    return (
      <ContextActions
        key={item.placementId}
        label={`Actions for ${group?.name ?? 'Group chat'}`}
        items={[
          {
            label: 'Move to section',
            action: () => {},
            items: [
              ...org.sections.map((s) => ({
                label: sectionChoiceLabel(s),
                checked: s.id === sectionId,
                action: () => onChange((current) => placeItem(current, item.placementId, s.id)),
              })),
              {
                label: 'New section',
                icon: Plus,
                separatorBefore: true,
                action: () =>
                  onEditOrganization({ kind: 'new-section', placementId: item.placementId }),
              },
            ],
          },
          ...(group && onDeleteGroup
            ? [
                {
                  label: 'Delete group',
                  icon: Trash2,
                  danger: true,
                  separatorBefore: true,
                  action: () => onDeleteGroup(group),
                },
              ]
            : []),
        ]}
      >
        {content}
      </ContextActions>
    );
  }
  return (
    <>
      {org.sections.map((section) =>
        isSystemSection(section.id) ? (
          <motion.div
            layout
            transition={move}
            key={section.id}
            className="pc-unsectioned"
            role="group"
            aria-label="Unsectioned conversations"
            {...targetEvents(section.id)}
          >
            {orderedRows(section)}
          </motion.div>
        ) : (
          <motion.section
            layout
            transition={move}
            key={section.id}
            className="pc-list"
            aria-label={section.name}
            {...targetEvents(section.id)}
          >
            <ContextActions
              label={`Actions for ${section.name} section`}
              items={[
                {
                  label: 'Rename section',
                  action: () => onEditOrganization({ kind: 'edit-section', id: section.id }),
                },
              ]}
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
                  className="pc-section-toggle justify-start"
                  aria-expanded={!section.collapsed}
                  onClick={() =>
                    onChange((current) => ({
                      sections: current.sections.map((s) =>
                        s.id === section.id ? { ...s, collapsed: !s.collapsed } : s,
                      ),
                    }))
                  }
                >
                  <ChevronDown
                    className="size-4 pointer-coarse:size-5"
                    data-collapsed={section.collapsed}
                  />
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
                  {orderedRows(section)}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        ),
      )}
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
    [original, setOriginal] = useState(''),
    [members, setMembers] = useState<string[]>([]),
    [creationId, setCreationId] = useState('');
  const [discard, setDiscard] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const organizationRef = useRef(org);
  organizationRef.current = org;
  const isGroup = editor?.kind === 'new-group-chat';
  function requestClose() {
    if (pending) return false;
    if (name !== original || members.length) {
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
    const value =
      editor.kind === 'edit-section'
        ? (organizationRef.current.sections.find((s) => s.id === editor.id)?.name ?? '')
        : '';
    setName(value);
    setOriginal(value);
    setMembers([]);
    setCreationId(crypto.randomUUID());
    setError('');
    setPending(false);
  }, [editor]);
  async function save() {
    if (!editor || pending || !name.trim()) return;
    setPending(true);
    setError('');
    try {
      if (isGroup) await onCreateGroup({ id: creationId, name: name.trim(), members });
      else if (editor.kind === 'edit-section')
        onChange((current) => ({
          sections: current.sections.map((s) =>
            s.id === editor.id ? { ...s, name: name.trim() } : s,
          ),
        }));
      else if (editor.kind === 'new-section') {
        const sectionId = `section-${creationId}`;
        onChange((current) => {
          const next = {
            sections: [
              ...current.sections,
              { id: sectionId, name: name.trim(), collapsed: false, items: [] },
            ],
          };
          return editor.placementId
            ? placeItem(next, editor.placementId, sectionId)
            : editor.pebbleId
              ? placePebble(next, editor.pebbleId, { kind: 'section', id: sectionId })
              : next;
        });
      }
      onClose();
    } catch (failure) {
      setError(safeError(failure).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open={!!editor}
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        size="content"
        className="overflow-clip"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.querySelector<HTMLElement>('[aria-label="New"]')?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {isGroup
              ? 'New group chat'
              : editor?.kind === 'edit-section'
                ? 'Rename section'
                : 'New section'}
          </DialogTitle>
          <DialogDescription className="sr-only">Organize your conversations.</DialogDescription>
        </DialogHeader>
        <Form
          className="flex min-h-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="flex min-h-0 flex-col gap-4 overflow-clip px-1 pb-1">
            <div className="grid shrink-0 gap-2">
              <Label htmlFor="organization-name">Name</Label>
              <Input
                id="organization-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={isGroup ? 80 : 60}
                disabled={pending}
              />
            </div>
            {isGroup && (
              <div className="flex min-h-0 min-w-0 flex-col gap-2">
                <span className="shrink-0 text-sm font-medium">Pebbles</span>
                <div
                  role="group"
                  aria-label="Group members"
                  className="flex min-h-0 max-h-64 flex-col gap-1 overflow-y-auto"
                >
                  {pebbles.map((p) => (
                    <label
                      key={p.id}
                      className="flex min-h-12 shrink-0 cursor-pointer items-center gap-3 rounded-lg px-2 py-1 hover:bg-muted/50"
                    >
                      <Checkbox
                        aria-label={p.name}
                        checked={members.includes(p.id)}
                        disabled={pending || (!members.includes(p.id) && members.length >= 6)}
                        onCheckedChange={(checked) =>
                          setMembers((old) =>
                            checked ? [...old, p.id] : old.filter((id) => id !== p.id),
                          )
                        }
                      />
                      <span className="size-8 shrink-0 [&_.agent-avatar]:size-8">{face(p.id)}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                      <span className="text-xs text-muted-foreground">@{p.handle}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter className="shrink-0">
            {editor?.kind === 'edit-section' && (
              <Button
                type="button"
                variant="destructive-ghost"
                className="mr-auto"
                disabled={pending}
                onClick={() => {
                  onChange((current) => removeSection(current, editor.id));
                  onClose();
                }}
              >
                Remove section
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={requestClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                pending || !name.trim() || (isGroup && (members.length < 2 || members.length > 6))
              }
            >
              {editor?.kind === 'edit-section' ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
      <DiscardChanges
        open={discard}
        onOpenChange={setDiscard}
        onDiscard={() => {
          setDiscard(false);
          onClose();
        }}
      />
    </Dialog>
  );
}
