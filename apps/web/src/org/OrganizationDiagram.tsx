import { useId, useLayoutEffect, useRef, type RefObject } from 'react';
import { useReducedMotion } from 'motion/react';
import { TransformComponent, TransformWrapper, useControls } from 'react-zoom-pan-pinch';
import { LocateFixed, Maximize, Minus, Plus } from 'lucide-react';
import type { SessionClient, WorkspaceSnapshot } from '@hermes-client/protocol';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { IconButton } from '../components/ui/icon-button';
import { PebbleAvatar } from '../chat/Rail';
import { orgCard, organizationLayout } from './layout';

type Diagram = ReturnType<typeof organizationLayout>;

function ChartCards({
  layout,
  workspace,
  client,
  onEdit,
  landmark,
}: {
  layout: Diagram;
  workspace: WorkspaceSnapshot;
  client: SessionClient;
  onEdit: (profile: string) => void;
  landmark: RefObject<string | null>;
}) {
  const id = useId();
  const reduced = useReducedMotion();
  const { zoomToElement, setTransform, instance } = useControls();
  const previous = useRef(layout);
  useLayoutEffect(() => {
    const before = previous.current.nodes.find((node) => node.bot.profile === landmark.current);
    const after = layout.nodes.find((node) => node.bot.profile === landmark.current);
    previous.current = layout;
    if (before && after && (before.x !== after.x || before.y !== after.y)) {
      const { positionX, positionY, scale } = instance.state;
      void setTransform(
        positionX + (before.x - after.x) * scale,
        positionY + (before.y - after.y) * scale,
        scale,
        0,
      );
    }
  }, [layout, landmark, instance, setTransform]);
  return (
    <div className="pc-org-diagram" style={{ width: layout.width, height: layout.height }}>
      <svg
        className="pc-org-connectors"
        width={layout.width}
        height={layout.height}
        aria-hidden="true"
      >
        {layout.links.map((link) => (
          <path
            key={link.child}
            data-org-parent={link.parent}
            data-org-child={link.child}
            d={link.path}
          />
        ))}
      </svg>
      {layout.groups.map((group) => (
        <section key={group.id} className="pc-org-band" aria-label={group.label}>
          {group.id !== 'reporting' && (
            <h2 style={{ left: orgCard.padding, top: group.y }}>{group.label}</h2>
          )}
          <ul className="pc-org-nodes">
            {layout.nodes
              .filter((node) => node.group === group.id)
              .map((node) => {
                const bot = node.bot;
                const main = bot.profile === workspace.orchestrator;
                const manager = workspace.bots.find((parent) => parent.profile === bot.manager);
                return (
                  <li
                    key={bot.id}
                    id={id + bot.id}
                    data-org-profile={bot.profile}
                    style={{
                      left: node.x,
                      top: node.y,
                      width: orgCard.width,
                      height: orgCard.height,
                    }}
                  >
                    <Card asChild>
                      <Button
                        variant="ghost"
                        className="pc-org-card h-full w-full flex-col items-stretch justify-start gap-0 overflow-hidden p-0 text-left shadow-none [&_.agent-avatar]:h-11 [&_.agent-avatar]:w-10"
                        onFocus={(event) => {
                          if (event.currentTarget.matches(':focus-visible')) {
                            landmark.current = bot.profile;
                            void zoomToElement(
                              event.currentTarget.closest('li') ?? event.currentTarget,
                              1,
                              reduced ? 0 : 160,
                            );
                          }
                        }}
                        onClick={() => {
                          landmark.current = bot.profile;
                          onEdit(bot.profile);
                        }}
                      >
                        <span className="sr-only">Edit </span>
                        <span className="flex min-h-0 flex-1 items-center gap-3 px-4 py-3">
                          <span aria-hidden="true" className="shrink-0">
                            <PebbleAvatar bot={bot} workspace={workspace} client={client} />
                          </span>
                          <span className="pc-org-identity">
                            <span className="truncate text-sm font-semibold">{bot.name}</span>
                            {bot.role.title && (
                              <span className="truncate text-xs text-muted-foreground">
                                {bot.role.title}
                              </span>
                            )}
                            <span className="truncate text-xs text-muted-foreground">
                              @{bot.handle}
                            </span>
                            <span className="sr-only">
                              {main
                                ? 'Reports to you'
                                : manager
                                  ? `Reports to ${manager.name}`
                                  : 'No manager'}
                            </span>
                          </span>
                        </span>
                        <span className="pc-org-card-footer flex h-8 shrink-0 items-center justify-between gap-2 px-4 pb-2 text-xs font-normal text-muted-foreground">
                          {main ? (
                            <Badge variant="secondary" className="text-xs font-normal">
                              Main Pebble
                            </Badge>
                          ) : (
                            <span>{bot.hidden ? 'Hidden from chats' : ''}</span>
                          )}
                          <span>
                            {node.reports > 0
                              ? `${node.reports} ${node.reports === 1 ? 'report' : 'reports'}`
                              : ''}
                          </span>
                        </span>
                      </Button>
                    </Card>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function OrganizationDiagram({
  workspace,
  client,
  onEdit,
}: {
  workspace: WorkspaceSnapshot;
  client: SessionClient;
  onEdit: (profile: string) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const landmark = useRef(workspace.orchestrator);
  const reduced = useReducedMotion();
  const layout = organizationLayout(workspace);
  const anchor =
    layout.nodes.find((node) => node.bot.profile === workspace.orchestrator) ?? layout.nodes[0];
  return (
    <div className="pc-org-chart">
      <TransformWrapper
        minScale={0.01}
        maxScale={2}
        limitToBounds={false}
        centerZoomedOut={false}
        trackPadPanning={{ disabled: true }}
        panning={{ excluded: ['button'], velocityDisabled: true }}
        doubleClick={{ disabled: true }}
        keyboard={{ disabled: false }}
        onInit={(controls) => {
          const width = controls.instance.wrapperComponent?.clientWidth;
          if (anchor && width)
            void controls.setTransform(
              width / 2 - anchor.x - orgCard.width / 2,
              32 - anchor.y,
              1,
              0,
            );
        }}
      >
        {(controls) => (
          <>
            <div
              className="pc-org-controls flex shrink-0 justify-end gap-1 px-6 pb-3"
              role="toolbar"
              aria-label="Chart view"
            >
              <IconButton
                quiet
                label="Zoom out"
                icon={Minus}
                onClick={() => void controls.zoomOut(0.4, reduced ? 0 : 180)}
              />
              <IconButton
                quiet
                label="Zoom in"
                icon={Plus}
                onClick={() => void controls.zoomIn(0.4, reduced ? 0 : 180)}
              />
              <IconButton
                quiet
                label="Fit chart"
                icon={Maximize}
                onClick={() => {
                  landmark.current = workspace.orchestrator;
                  void controls.centerView(
                    Math.min(
                      1,
                      ((viewport.current?.clientWidth ?? 800) - 48) / layout.width,
                      ((viewport.current?.clientHeight ?? 600) - 48) / layout.height,
                    ),
                    reduced ? 0 : 180,
                  );
                }}
              />
              <IconButton
                quiet
                label="Center Main Pebble"
                icon={LocateFixed}
                onClick={() => {
                  landmark.current = workspace.orchestrator;
                  if (anchor)
                    void controls.setTransform(
                      (viewport.current?.clientWidth ?? 800) / 2 - anchor.x - orgCard.width / 2,
                      32 - anchor.y,
                      1,
                      reduced ? 0 : 180,
                    );
                }}
              />
            </div>
            <div className="pc-org-viewport" ref={viewport}>
              <TransformComponent
                wrapperClass="pc-org-transform"
                contentClass="pc-org-content"
                wrapperStyle={{ width: '100%', height: '100%', overflow: 'clip' }}
                wrapperProps={{ tabIndex: 0, role: 'group', 'aria-label': 'Organization canvas' }}
              >
                <ChartCards
                  layout={layout}
                  workspace={workspace}
                  client={client}
                  onEdit={onEdit}
                  landmark={landmark}
                />
              </TransformComponent>
            </div>
          </>
        )}
      </TransformWrapper>
    </div>
  );
}
