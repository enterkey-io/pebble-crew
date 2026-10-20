import { DiscardChanges } from './DiscardChanges';
import { Form } from '../components/ui/form';
import { useEffect, useState } from 'react';
import type { Dispatch, DragEvent, ReactNode, SetStateAction } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronDown, MoreHorizontal, Pin, SlidersHorizontal, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NavigationItem } from './NavigationItem';
import { UnreadDot } from './UnreadDot';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
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
} from './organization';
import type { Organization, OrganizationEditor, Placement, RailDrag } from './organization';
import { useOverlayHistory } from './overlay-history';
import { EmptyMenuItem } from './primitives';

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

function PlacementMenu({
  org,
  value,
  onMove,
}: {
  org: Organization;
  value: Placement | undefined;
  onMove: (target: Placement) => void;
}) {
  const sections = org.sections.filter((section) => sectionAccepts(section.id, 'pebble'));
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Move to section</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={value?.kind === 'section' ? value.id : ''}>
            {!sections.length && <EmptyMenuItem />}
            {sections.map((section) => (
              <DropdownMenuRadioItem
                key={section.id}
                value={section.id}
                onSelect={() => onMove({ kind: 'section', id: section.id })}
              >
                {sectionChoiceLabel(section)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Move to crew</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {!org.crews.length && <EmptyMenuItem />}
          <DropdownMenuRadioGroup value={value?.kind === 'crew' ? value.id : ''}>
            {org.crews.map((crew) => (
              <DropdownMenuRadioItem
                key={crew.id}
                value={crew.id}
                onSelect={() => onMove({ kind: 'crew', id: crew.id })}
              >
                {crew.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}

export function PebbleActions({
  pebble,
  onPin,
  onEdit,
  org,
  onChange,
}: {
  pebble: RailPebble;
  onPin: () => void;
  onEdit: () => void;
  org: Organization;
  onChange: ChangeOrganization;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="quiet"
          size="icon-sm"
          className="pc-overflow"
          aria-label={`Actions for ${pebble.name}`}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6}>
        <DropdownMenuItem onSelect={onPin}>
          <Pin />
          {pebble.pinned ? 'Unpin' : 'Pin'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onEdit}>
          <SlidersHorizontal />
          Edit pebble
        </DropdownMenuItem>
        <PlacementMenu
          org={org}
          value={placementOf(org, pebble.id)}
          onMove={(target) => onChange((current) => placePebble(current, pebble.id, target))}
        />
      </DropdownMenuContent>
    </DropdownMenu>
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
  actions?: (id: string) => ReactNode;
  openLabel?: (pebble: RailPebble) => string;
  org: Organization;
  onChange: ChangeOrganization;
  pebbles: RailPebble[];
  activeId: string;
  face: (id: string) => ReactNode;
  onOpenPebble: (id: string) => void;
  onOpenCrew: (id: string) => void;
  onEditPebble: (id: string) => void;
  onEditOrganization: (editor: OrganizationEditor) => void;
  onPin: (id: string) => void;
}) {
  const reduced = useReducedMotion();
  const pinnedIds = pebbles.filter((p) => p.pinned).map((p) => p.id);
  const [over, setOver] = useState('');
  const move = { duration: reduced ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] as const };
  function dropped(event: DragEvent, target: Placement, beforeId?: string) {
    event.preventDefault();
    event.stopPropagation();
    setOver('');
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
      (target.kind !== 'section' || sectionAccepts(target.id, 'pebble'))
    )
      onPin(item.id);
    onChange((current) => {
      if (item.kind === 'section')
        return target.kind === 'section' ? reorderSection(current, item.id, target.id) : current;
      if (item.kind === 'pebble') return placePebble(current, item.id, target, beforeId);
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
  function targetEvents(target: Placement, beforeId?: string) {
    const key = `${target.kind}:${target.id}:${beforeId ?? ''}`;
    return {
      onDragOver: (event: DragEvent) => {
        allow(event);
        if (event.defaultPrevented) setOver(key);
      },
      onDragLeave: () => setOver(''),
      onDrop: (event: DragEvent) => dropped(event, target, beforeId),
      'data-drop-target': over === key || undefined,
    };
  }
  function row(id: string, target: Placement) {
    const pebble = pebbles.find((p) => p.id === id);
    if (!pebble || pebble.pinned) return null;
    return (
      <motion.div
        layout="position"
        layoutId={`pebble-${id}`}
        onKeyDown={(event) => {
          if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            onChange((current) =>
              nudgeItem(
                current,
                { kind: 'pebble', id },
                event.key === 'ArrowUp' ? -1 : 1,
                pinnedIds,
              ),
            );
          }
        }}
        transition={move}
        key={id}
        className={`pc-row pebble-row ${activeId === id ? 'is-selected' : ''}`}
        data-unread={pebble.unread || undefined}
        draggable
        onDragStartCapture={(event) => drag(event, { kind: 'pebble', id })}
        onDragEnd={() => setOver('')}
        {...targetEvents(target, id)}
      >
        <NavigationItem
          media={
            <span className="flex [&>.agent-avatar]:h-12 [&>.agent-avatar]:w-11">{face(id)}</span>
          }
          title={pebble.name}
          label={pebble.title}
          description={<span aria-hidden="true">{pebble.preview}</span>}
          onClick={() => onOpenPebble(id)}
          aria-label={
            openLabel?.(pebble) ?? `Open ${pebble.name} ${pebble.title} ${pebble.preview}`
          }
        />
        {actions ? (
          actions(id)
        ) : (
          <PebbleActions
            pebble={pebble}
            onPin={() => onPin(id)}
            onEdit={() => onEditPebble(id)}
            org={org}
            onChange={onChange}
          />
        )}
        {pebble.unread && <UnreadDot />}
      </motion.div>
    );
  }
  function crewRow(id: string, sectionId: string) {
    const crew = org.crews.find((c) => c.id === id);
    if (!crew) return null;
    return (
      <motion.div layout transition={move} key={id} className="pc-crew-group">
        <div
          className={`pc-row pc-crew-row ${activeId === id ? 'is-selected' : ''}`}
          draggable
          onDragStart={(event) => drag(event, { kind: 'crew', id })}
          onDragEnd={() => setOver('')}
          {...targetEvents({ kind: 'crew', id })}
        >
          <NavigationItem
            className="pc-crew"
            title={crew.name}
            description={`${crew.members.length} pebbles`}
            aria-label={`${crew.name} ${crew.members.length} pebbles. Open chat`}
            onClick={() => onOpenCrew(id)}
            media={
              <span className="pc-crew-faces">
                {crew.members.length ? (
                  crew.members.slice(0, 2).map((member) => <span key={member}>{face(member)}</span>)
                ) : (
                  <Users />
                )}
              </span>
            }
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="quiet"
                size="icon-sm"
                className="pc-overflow"
                aria-label={`Actions for ${crew.name}`}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onEditOrganization({ kind: 'edit-crew', id })}>
                <SlidersHorizontal />
                Crew settings
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  onChange((current) => ({
                    ...current,
                    crews: current.crews.map((c) =>
                      c.id === id ? { ...c, collapsed: !c.collapsed } : c,
                    ),
                  }))
                }
              >
                {crew.collapsed ? 'Show pebbles' : 'Collapse pebbles'}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Move to section</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={sectionId}>
                    {!org.sections.some((section) => sectionAccepts(section.id, 'crew')) && (
                      <EmptyMenuItem />
                    )}
                    {org.sections
                      .filter((section) => sectionAccepts(section.id, 'crew'))
                      .map((section) => (
                        <DropdownMenuRadioItem
                          key={section.id}
                          value={section.id}
                          onSelect={() => onChange((current) => placeCrew(current, id, section.id))}
                        >
                          {section.name}
                        </DropdownMenuRadioItem>
                      ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <AnimatePresence initial={false}>
          {!crew.collapsed && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              transition={move}
              style={{ overflow: 'hidden' }}
              className="pc-crew-members"
              aria-label={`${crew.name} pebbles`}
              {...targetEvents({ kind: 'crew', id })}
            >
              {crew.members.map((member) => row(member, { kind: 'crew', id }))}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
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
              item.kind === 'pebble' ? row(item.id, { kind: 'section', id: section.id }) : null,
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
            <div
              className="pc-section-header"
              draggable
              onDragStart={(event) => drag(event, { kind: 'section', id: section.id })}
              onDragEnd={() => setOver('')}
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
              {!isSystemSection(section.id) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="quiet"
                      size="icon-sm"
                      className="pc-overflow"
                      aria-label={`Actions for ${section.name} section`}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => onEditOrganization({ kind: 'edit-section', id: section.id })}
                    >
                      Rename section
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
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
  onChange,
  onClose,
}: {
  editor: OrganizationEditor | null;
  org: Organization;
  onChange: ChangeOrganization;
  onClose: () => void;
}) {
  const [name, setName] = useState(''),
    [purpose, setPurpose] = useState('');
  const [original, setOriginal] = useState({ name: '', purpose: '' });
  const [discard, setDiscard] = useState(false);
  const isCrew = editor?.kind === 'new-crew' || editor?.kind === 'edit-crew';
  function requestClose() {
    if (name !== original.name || purpose !== original.purpose) {
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
    setOriginal({
      name: entity?.name ?? '',
      purpose: entity && 'purpose' in entity ? entity.purpose : '',
    });
    setDiscard(false);
  }, [editor]);
  function save() {
    if (!editor || !name.trim()) return;
    const id = crypto.randomUUID();
    onChange((current) => {
      switch (editor.kind) {
        case 'new-section':
          return {
            ...current,
            sections: [...current.sections, { id, name: name.trim(), collapsed: false, items: [] }],
          };
        case 'edit-section':
          return {
            ...current,
            sections: current.sections.map((s) =>
              s.id === editor.id ? { ...s, name: name.trim() } : s,
            ),
          };
        case 'new-crew':
          return {
            ...current,
            crews: [
              ...current.crews,
              { id, name: name.trim(), purpose, collapsed: false, members: [] },
            ],
            sections: current.sections.map((s) =>
              s.id === 'crews' ? { ...s, items: [...s.items, { kind: 'crew', id }] } : s,
            ),
          };
        case 'edit-crew':
          return {
            ...current,
            crews: current.crews.map((c) =>
              c.id === editor.id ? { ...c, name: name.trim(), purpose } : c,
            ),
          };
      }
    });
    onClose();
  }
  const title =
    editor?.kind === 'edit-crew'
      ? 'Crew settings'
      : editor?.kind === 'edit-section'
        ? 'Rename section'
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
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.querySelector<HTMLElement>('[aria-label="New"]')?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Organize your sidebar. Agent profiles and chat history stay intact.
          </DialogDescription>
        </DialogHeader>
        <Form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          className="pc-organization-form"
        >
          <div>
            <Label htmlFor="organization-name">Name</Label>
            <Input
              id="organization-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
            />
          </div>
          {isCrew && (
            <div>
              <Label htmlFor="organization-purpose">Purpose</Label>
              <Textarea
                id="organization-purpose"
                rows={3}
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
              />
            </div>
          )}
          <div className="pc-form-footer">
            {editor?.kind === 'edit-crew' && (
              <Button
                type="button"
                variant="destructive-ghost"
                className="mr-auto"
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
                  className="mr-auto"
                  onClick={() => {
                    onChange((current) => removeSection(current, editor.id));
                    onClose();
                  }}
                >
                  Remove section
                </Button>
              )}
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!name.trim()} type="submit">
              {editor?.kind.startsWith('new') ? 'Create' : 'Save changes'}
            </Button>
          </div>
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
