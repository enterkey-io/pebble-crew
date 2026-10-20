import { useState } from 'react';
import { Check, FileText, Folder } from 'lucide-react';
import { BarChart, Bar, XAxis } from 'recharts';
import { Button } from '../../components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';
import { AspectRatio } from '../../components/ui/aspect-ratio';
import { Avatar, AvatarFallback } from '../../components/ui/avatar';
import { Badge } from '../../components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from '../../components/ui/breadcrumb';
import { Bubble, BubbleContent } from '../../components/ui/bubble';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '../../components/ui/card';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from '../../components/ui/carousel';
import { ChartContainer } from '../../components/ui/chart';
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockActions,
  CodeBlockCopyButton,
} from '../../components/ui/code-block';
import { DataTable } from '../../components/ui/data-table';
import { DirectionProvider } from '../../components/ui/direction';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '../../components/ui/empty';
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription } from '../../components/ui/item';
import { Kbd, KbdGroup } from '../../components/ui/kbd';
import { Marker, MarkerIcon, MarkerContent } from '../../components/ui/marker';
import { Message, MessageContent, MessageHeader, MessageFooter } from '../../components/ui/message';
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
} from '../../components/ui/message-scroller';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from '../../components/ui/pagination';
import { Progress } from '../../components/ui/progress';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '../../components/ui/resizable';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Separator } from '../../components/ui/separator';
import { Skeleton } from '../../components/ui/skeleton';
import { Spinner } from '../../components/ui/spinner';
import { Stepper } from '../../components/ui/stepper';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from '../../components/ui/table';
import { Toaster, toast } from '../../components/ui/sonner';
import {
  Trace,
  TraceLine,
  TraceTitle,
  TraceIcon,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
} from '../../components/ui/trace';
import { Typography } from '../../components/ui/typography';
import {
  Attachment,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
} from '../../components/ui/attachment';
import type { SpecimenProps } from '../specimen-types';

const rows = [
  { id: 'aurora', name: 'Aurora', title: 'Chief of Staff' },
  { id: 'grace', name: 'Grace', title: 'Executive Assistant' },
];
function TableSample({ kind }: { kind: 'table' | 'data-table' }) {
  return kind === 'data-table' ? (
    <DataTable
      label="Sample pebbles"
      rows={rows}
      rowKey={(x) => x.id}
      columns={[
        { id: 'name', header: 'Name', cell: (x) => x.name },
        { id: 'title', header: 'Title', cell: (x) => x.title },
      ]}
    />
  ) : (
    <Table>
      <TableCaption>Local sample pebbles</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Name</TableHead>
          <TableHead scope="col">Title</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((x) => (
          <TableRow key={x.id}>
            <TableCell>{x.name}</TableCell>
            <TableCell>{x.title}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
function Pages() {
  const [page, setPage] = useState(1);
  return (
    <Pagination>
      <PaginationContent>
        {[1, 2, 3].map((x) => (
          <PaginationItem key={x}>
            <PaginationLink
              href={`#page-${x}`}
              isActive={page === x}
              onClick={(e) => {
                e.preventDefault();
                setPage(x);
              }}
            >
              {x}
            </PaginationLink>
          </PaginationItem>
        ))}
      </PaginationContent>
    </Pagination>
  );
}
function Code() {
  const code = 'const crew = ["Aurora", "Grace"];\nconsole.info(crew.length);';
  return (
    <CodeBlock>
      <CodeBlockHeader>
        <CodeBlockTitle>example.ts</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent lineNumbers>{code}</CodeBlockContent>
    </CodeBlock>
  );
}
function History() {
  return (
    <div className="h-64">
      <MessageScrollerProvider>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent>
              {Array.from({ length: 12 }, (_, i) => (
                <MessageScrollerItem key={i}>
                  <Bubble variant="muted">
                    <BubbleContent>Sample message {i + 1}</BubbleContent>
                  </Bubble>
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  );
}
function Notification({ mode }: SpecimenProps) {
  return (
    <>
      <Button
        variant="outline"
        disabled={mode === 'disabled'}
        onClick={() =>
          mode === 'error'
            ? toast.error('Unable to save this sample')
            : toast.success('Saved locally')
        }
      >
        Show notification
      </Button>
      <Toaster />
    </>
  );
}
function TraceSample({ mode }: SpecimenProps) {
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine status={mode === 'error' ? 'error' : 'running'}>
            <TraceIcon>
              <FileText />
            </TraceIcon>
            <TraceTitle>{mode === 'error' ? 'Could not read file' : 'Reading file'}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Code />
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
export const contentSpecimens = {
  alert: ({ mode }: SpecimenProps) => (
    <Alert variant={mode === 'error' ? 'destructive' : 'default'}>
      <AlertTitle>{mode === 'error' ? 'Unable to save' : 'Update available'}</AlertTitle>
      <AlertDescription>
        {mode === 'error' ? 'Your changes are still here. Try again.' : 'Ready when you are.'}
      </AlertDescription>
    </Alert>
  ),
  'aspect-ratio': () => (
    <AspectRatio ratio={16 / 9} className="grid place-items-center rounded-lg bg-muted">
      <Folder aria-label="Media placeholder" className="size-8 text-muted-foreground" />
    </AspectRatio>
  ),
  avatar: () => (
    <Avatar className="size-12">
      <AvatarFallback>EK</AvatarFallback>
    </Avatar>
  ),
  badge: () => <Badge variant="secondary">Connected</Badge>,
  breadcrumb: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#system">Crew</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Files</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
  bubble: () => (
    <div className="flex flex-col gap-4">
      <Bubble variant="muted">
        <BubbleContent>I found the file.</BubbleContent>
      </Bubble>
      <Bubble align="end" variant="secondary">
        <BubbleContent>Thank you.</BubbleContent>
      </Bubble>
    </div>
  ),
  card: () => (
    <Card>
      <CardHeader>
        <CardTitle>Research</CardTitle>
        <CardDescription>Local sample</CardDescription>
      </CardHeader>
      <CardContent>Notes and shared resources.</CardContent>
    </Card>
  ),
  carousel: () => (
    <Carousel aria-label="Sample media" className="mx-10">
      <CarouselContent>
        {[1, 2, 3].map((x) => (
          <CarouselItem key={x}>
            <AspectRatio
              ratio={4 / 3}
              className="grid place-items-center rounded-lg bg-muted text-muted-foreground"
            >
              Image {x}
            </AspectRatio>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  ),
  chart: () => (
    <ChartContainer
      config={{ count: { label: 'Sample count', color: 'var(--chart-1)' } }}
      className="h-52 w-full"
    >
      <BarChart
        accessibilityLayer
        data={[
          { name: 'A', count: 3 },
          { name: 'B', count: 5 },
          { name: 'C', count: 4 },
        ]}
      >
        <XAxis dataKey="name" />
        <Bar dataKey="count" fill="var(--color-count)" radius={4} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  ),
  'code-block': Code,
  'data-table': () => <TableSample kind="data-table" />,
  table: () => <TableSample kind="table" />,
  direction: () => (
    <DirectionProvider dir="rtl">
      <div dir="rtl" className="flex gap-3">
        <span>١</span>
        <span>٢</span>
        <span>٣</span>
      </div>
    </DirectionProvider>
  ),
  empty: () => (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No files yet</EmptyTitle>
        <EmptyDescription>Files shared in this chat appear here.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  ),
  item: () => (
    <Item>
      <ItemMedia>
        <FileText />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>Project notes</ItemTitle>
        <ItemDescription>Shared by Aurora</ItemDescription>
      </ItemContent>
    </Item>
  ),
  kbd: () => (
    <KbdGroup>
      <Kbd>⌘</Kbd>
      <Kbd>K</Kbd>
    </KbdGroup>
  ),
  marker: () => (
    <Marker>
      <MarkerIcon>
        <Check />
      </MarkerIcon>
      <MarkerContent>Saved</MarkerContent>
    </Marker>
  ),
  message: () => (
    <Message>
      <MessageContent>
        <MessageHeader>Aurora</MessageHeader>
        <Bubble variant="muted">
          <BubbleContent>The notes are ready.</BubbleContent>
        </Bubble>
        <MessageFooter>
          <time dateTime="2026-10-17T15:35:00Z">10:35 AM</time>
        </MessageFooter>
      </MessageContent>
    </Message>
  ),
  'message-scroller': History,
  pagination: Pages,
  progress: ({ mode }: SpecimenProps) => (
    <Progress value={mode === 'disabled' ? 0 : 60} aria-label="Sample progress" />
  ),
  resizable: () => (
    <ResizablePanelGroup orientation="horizontal" className="min-h-48 rounded-lg bg-muted">
      <ResizablePanel minSize="25%" className="grid place-items-center">
        Chat
      </ResizablePanel>
      <ResizableHandle aria-label="Resize details" />
      <ResizablePanel minSize="25%" className="grid place-items-center">
        Details
      </ResizablePanel>
    </ResizablePanelGroup>
  ),
  'scroll-area': () => (
    <ScrollArea className="h-48 rounded-lg bg-card">
      <ul className="p-4">
        {Array.from({ length: 24 }, (_, i) => (
          <li key={i} className="py-2">
            File {i + 1}
          </li>
        ))}
      </ul>
    </ScrollArea>
  ),
  separator: () => (
    <div className="grid gap-4">
      <p>Files</p>
      <Separator />
      <p>Routines</p>
    </div>
  ),
  skeleton: () => (
    <div aria-label="Loading sample" className="grid gap-3">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  ),
  spinner: () => <Spinner aria-label="Loading" />,
  stepper: () => (
    <Stepper
      steps={[
        { id: 'account', label: 'Account', state: 'complete' },
        { id: 'pebble', label: 'Pebble', state: 'current' },
        { id: 'done', label: 'Ready', state: 'pending' },
      ]}
    />
  ),
  sonner: Notification,
  toast: Notification,
  trace: TraceSample,
  typography: () => (
    <div className="grid gap-3">
      <Typography as="h2">Project notes</Typography>
      <Typography>A quiet, readable surface for your work.</Typography>
      <Typography as="small">Updated today</Typography>
    </div>
  ),
  attachment: ({ mode }: SpecimenProps) => (
    <Attachment state={mode === 'error' ? 'error' : 'done'}>
      <AttachmentMedia>
        <FileText />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>notes.pdf</AttachmentTitle>
        <AttachmentDescription>
          {mode === 'error' ? 'Upload failed' : '24 KB'}
        </AttachmentDescription>
      </AttachmentContent>
    </Attachment>
  ),
};
