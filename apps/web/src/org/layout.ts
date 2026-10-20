import { reportingForest } from '@hermes-client/protocol';
import type { WorkspaceBot, WorkspaceSnapshot } from '@hermes-client/protocol';

export const orgCard = { width: 240, height: 128, gap: 32, levelGap: 64, padding: 32 };

export function organizationLayout(workspace: WorkspaceSnapshot) {
  const forest = reportingForest(workspace);
  const spans = new Map<string, number>();
  const centers = new Map<string, number>();
  function measure(bot: WorkspaceBot): number {
    const reports = forest.children.get(bot.profile) ?? [];
    const span = Math.max(
      orgCard.width,
      reports.reduce((sum, child) => sum + measure(child), 0) +
        Math.max(0, reports.length - 1) * orgCard.gap,
    );
    spans.set(bot.profile, span);
    let left = 0;
    const reportCenters = reports.map((report) => {
      const width = spans.get(report.profile) ?? orgCard.width;
      const center = left + (centers.get(report.profile) ?? width / 2);
      left += width + orgCard.gap;
      return center;
    });
    const first = reportCenters[0];
    const last = reportCenters.at(-1);
    centers.set(
      bot.profile,
      first !== undefined && last !== undefined ? (first + last) / 2 : span / 2,
    );
    return span;
  }
  const groups = [
    { id: 'reporting', label: 'Reporting relationships', roots: forest.main ? [forest.main] : [] },
    { id: 'unattached', label: 'Unattached', roots: forest.unattached },
    { id: 'invalid', label: 'Needs attention', roots: forest.invalid },
  ]
    .filter((group) => group.roots.length)
    .map((group) => ({
      ...group,
      width:
        group.roots.reduce((sum, root) => sum + measure(root), 0) +
        Math.max(0, group.roots.length - 1) * orgCard.gap,
    }));
  const width =
    Math.max(orgCard.width, ...groups.map((group) => group.width)) + orgCard.padding * 2;
  const nodes: { bot: WorkspaceBot; x: number; y: number; group: string; reports: number }[] = [];
  const links: { parent: string; child: string; path: string }[] = [];
  let bottom = orgCard.padding;
  const bands = groups.map((group) => {
    const top = bottom;
    let left = (width - group.width) / 2;
    let groupBottom = top;
    function place(bot: WorkspaceBot, x: number, y: number) {
      const span = spans.get(bot.profile) ?? orgCard.width;
      const center = x + (centers.get(bot.profile) ?? span / 2);
      const reports = forest.children.get(bot.profile) ?? [];
      nodes.push({
        bot,
        x: center - orgCard.width / 2,
        y,
        group: group.id,
        reports: reports.length,
      });
      groupBottom = Math.max(groupBottom, y + orgCard.height);
      let childX = x;
      for (const child of reports) {
        const childSpan = spans.get(child.profile) ?? orgCard.width;
        const childY = y + orgCard.height + orgCard.levelGap;
        const middleY = childY - orgCard.levelGap / 2;
        links.push({
          parent: bot.profile,
          child: child.profile,
          path: `M ${center} ${y + orgCard.height} V ${middleY} H ${childX + (centers.get(child.profile) ?? childSpan / 2)} V ${childY}`,
        });
        place(child, childX, childY);
        childX += childSpan + orgCard.gap;
      }
    }
    for (const root of group.roots) {
      place(root, left, top + (group.id === 'reporting' ? 0 : 40));
      left += (spans.get(root.profile) ?? orgCard.width) + orgCard.gap;
    }
    bottom = groupBottom + 80;
    return { id: group.id, label: group.label, y: top };
  });
  return {
    width,
    height: Math.max(192, bottom - 80 + orgCard.padding),
    nodes,
    links,
    groups: bands,
  };
}
