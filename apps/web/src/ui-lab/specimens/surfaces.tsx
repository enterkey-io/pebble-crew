import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '../../components/ui/accordion';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '../../components/ui/collapsible';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '../../components/ui/dialog';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '../../components/ui/alert-dialog';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../../components/ui/sheet';
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '../../components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '../../components/ui/context-menu';
import {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
} from '../../components/ui/menubar';
import { Popover, PopoverTrigger, PopoverContent } from '../../components/ui/popover';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '../../components/ui/hover-card';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../components/ui/tooltip';
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink,
} from '../../components/ui/navigation-menu';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from '../../components/ui/sidebar';
import { EditorSurface } from '../../ui/EditorSurface';
import type { SpecimenProps } from '../specimen-types';

function Modal({
  mode,
  kind,
}: SpecimenProps & { kind: 'dialog' | 'alert-dialog' | 'sheet' | 'drawer' }) {
  const [confirmed, setConfirmed] = useState(false);
  const disabled = mode === 'disabled';
  const action = (
    <Button variant="outline" disabled={disabled}>
      Open {kind}
    </Button>
  );
  if (kind === 'alert-dialog')
    return (
      <>
        <AlertDialog>
          <AlertDialogTrigger asChild>{action}</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this sample?</AlertDialogTitle>
              <AlertDialogDescription>
                This changes only local preview state.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => setConfirmed(true)}>Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <span role="status">{confirmed ? 'Removed locally' : ''}</span>
      </>
    );
  if (kind === 'sheet')
    return (
      <Sheet>
        <SheetTrigger asChild>{action}</SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Pebble details</SheetTitle>
            <SheetDescription>Local preview</SheetDescription>
          </SheetHeader>
          <div className="p-6">Resource details stay within this panel.</div>
        </SheetContent>
      </Sheet>
    );
  if (kind === 'drawer')
    return (
      <Drawer>
        <DrawerTrigger asChild>{action}</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Pebble details</DrawerTitle>
            <DrawerDescription>Local preview</DrawerDescription>
          </DrawerHeader>
          <div className="px-6 pb-12">A touch-friendly surface with a stable header.</div>
        </DrawerContent>
      </Drawer>
    );
  return (
    <Dialog>
      <DialogTrigger asChild>{action}</DialogTrigger>
      <DialogContent className="flex h-[min(36rem,90dvh)] flex-col p-0">
        <EditorSurface
          className="p-6"
          header={
            <DialogHeader>
              <DialogTitle>Edit sample</DialogTitle>
              <DialogDescription>Local preview</DialogDescription>
            </DialogHeader>
          }
          navigation={
            <Tabs defaultValue="profile">
              <TabsList variant="line">
                <TabsTrigger value="profile">Profile</TabsTrigger>
                <TabsTrigger value="role">Role</TabsTrigger>
              </TabsList>
              <TabsContent value="profile">
                <Input aria-label="Sample name" defaultValue="Aurora" />
              </TabsContent>
              <TabsContent value="role">
                <p>Coordinates the crew.</p>
              </TabsContent>
            </Tabs>
          }
          footer={
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Close</Button>
              </DialogClose>
            </DialogFooter>
          }
        >
          Content scrolls independently of the title and actions.
        </EditorSurface>
      </DialogContent>
    </Dialog>
  );
}
function Menus({
  mode,
  kind,
}: SpecimenProps & { kind: 'dropdown-menu' | 'context-menu' | 'menubar' }) {
  const [selected, setSelected] = useState('');
  const items = ['Open', 'Pin', 'Edit'];
  const disabled = mode === 'disabled';
  return (
    <div className="grid gap-4">
      {kind === 'dropdown-menu' ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button disabled={disabled} variant="outline">
              Actions
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {items.map((x) => (
              <DropdownMenuItem key={x} onSelect={() => setSelected(x)}>
                {x}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : kind === 'context-menu' ? (
        <ContextMenu>
          <ContextMenuTrigger
            disabled={disabled}
            className="rounded-lg bg-muted p-8 text-center text-sm"
          >
            Right-click or long-press
          </ContextMenuTrigger>
          <ContextMenuContent>
            {items.map((x) => (
              <ContextMenuItem key={x} onSelect={() => setSelected(x)}>
                {x}
              </ContextMenuItem>
            ))}
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        <Menubar>
          <MenubarMenu>
            <MenubarTrigger disabled={disabled}>File</MenubarTrigger>
            <MenubarContent>
              {items.map((x) => (
                <MenubarItem key={x} onSelect={() => setSelected(x)}>
                  {x}
                </MenubarItem>
              ))}
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
      )}
      <span role="status">{selected}</span>
    </div>
  );
}
function Disclosure({ mode, kind }: SpecimenProps & { kind: 'accordion' | 'collapsible' }) {
  return kind === 'accordion' ? (
    <Accordion type="single" collapsible>
      <AccordionItem value="role">
        <AccordionTrigger disabled={mode === 'disabled'}>Responsibilities</AccordionTrigger>
        <AccordionContent>Planning, research and coordination.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="tools">
        <AccordionTrigger disabled={mode === 'disabled'}>Tools</AccordionTrigger>
        <AccordionContent>Only the owner's enabled tools are available.</AccordionContent>
      </AccordionItem>
    </Accordion>
  ) : (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="quiet" disabled={mode === 'disabled'}>
          Show details
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3 text-sm text-muted-foreground">
        Local sample details.
      </CollapsibleContent>
    </Collapsible>
  );
}
function Context({ mode, kind }: SpecimenProps & { kind: 'tooltip' | 'hover-card' | 'popover' }) {
  const trigger = (
    <Button variant="outline" disabled={mode === 'disabled'}>
      Aurora
    </Button>
  );
  if (kind === 'tooltip')
    return (
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent>Main Pebble</TooltipContent>
      </Tooltip>
    );
  if (kind === 'hover-card')
    return (
      <HoverCard>
        <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
        <HoverCardContent>
          <p className="font-medium">Aurora</p>
          <p className="mt-1 text-sm text-muted-foreground">Chief of Staff</p>
        </HoverCardContent>
      </HoverCard>
    );
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent>
        <p className="text-sm">Chief of Staff</p>
      </PopoverContent>
    </Popover>
  );
}
function Navigation({ mode }: SpecimenProps) {
  return (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger disabled={mode === 'disabled'}>Resources</NavigationMenuTrigger>
          <NavigationMenuContent className="min-w-48">
            <NavigationMenuLink href="#system">Files</NavigationMenuLink>
            <NavigationMenuLink href="#system">Routines</NavigationMenuLink>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  );
}
function TabSample({ mode }: SpecimenProps) {
  return (
    <Tabs defaultValue="profile">
      <TabsList variant="line">
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="role" disabled={mode === 'disabled'}>
          Role
        </TabsTrigger>
      </TabsList>
      <TabsContent value="profile" className="py-4">
        Aurora · Chief of Staff
      </TabsContent>
      <TabsContent value="role" className="py-4">
        Coordinates the crew.
      </TabsContent>
    </Tabs>
  );
}
function SideSample() {
  return (
    <SidebarProvider className="min-h-64 overflow-hidden rounded-xl">
      <Sidebar collapsible="none" className="w-full">
        <SidebarHeader>Pebble Crew</SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {['Aurora', 'Grace'].map((x) => (
                  <SidebarMenuItem key={x}>
                    <SidebarMenuButton>{x}</SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}
export const surfaceSpecimens = {
  accordion: (p: SpecimenProps) => <Disclosure {...p} kind="accordion" />,
  collapsible: (p: SpecimenProps) => <Disclosure {...p} kind="collapsible" />,
  dialog: (p: SpecimenProps) => <Modal {...p} kind="dialog" />,
  'alert-dialog': (p: SpecimenProps) => <Modal {...p} kind="alert-dialog" />,
  sheet: (p: SpecimenProps) => <Modal {...p} kind="sheet" />,
  drawer: (p: SpecimenProps) => <Modal {...p} kind="drawer" />,
  'dropdown-menu': (p: SpecimenProps) => <Menus {...p} kind="dropdown-menu" />,
  'context-menu': (p: SpecimenProps) => <Menus {...p} kind="context-menu" />,
  menubar: (p: SpecimenProps) => <Menus {...p} kind="menubar" />,
  tooltip: (p: SpecimenProps) => <Context {...p} kind="tooltip" />,
  'hover-card': (p: SpecimenProps) => <Context {...p} kind="hover-card" />,
  popover: (p: SpecimenProps) => <Context {...p} kind="popover" />,
  'navigation-menu': Navigation,
  tabs: TabSample,
  sidebar: SideSample,
};
