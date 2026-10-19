import {
  BookOpen,
  FilePenLine,
  FileText,
  Search,
  Globe,
  PanelsTopLeft,
  SquareTerminal,
  Image,
  ImagePlus,
  UsersRound,
  MessagesSquare,
  ListChecks,
  Brain,
  Smile,
  Mic,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const icons: Readonly<Record<string, LucideIcon>> = {
  read_file: BookOpen,
  read_files: BookOpen,
  read_document: BookOpen,
  read_pdf: BookOpen,
  skill_view: BookOpen,
  write_file: FilePenLine,
  patch: FilePenLine,
  apply_patch: FilePenLine,
  edit_file: FilePenLine,
  skill_manage: FilePenLine,
  search_files: Search,
  file_search: Search,
  search: Search,
  grep: Search,
  terminal: SquareTerminal,
  exec_command: SquareTerminal,
  process: SquareTerminal,
  run_command: SquareTerminal,
  execute_code: SquareTerminal,
  web_search: Globe,
  web_extract: Globe,
  web_fetch: Globe,
  browser: PanelsTopLeft,
  browser_navigate: PanelsTopLeft,
  vision_analyze: Image,
  view_image: Image,
  image_analyze: Image,
  screenshot: Image,
  image_generate: ImagePlus,
  generate_image: ImagePlus,
  message_agent: MessagesSquare,
  delegate_task: UsersRound,
  workspace_agents: UsersRound,
  todo: ListChecks,
  todo_write: ListChecks,
  update_plan: ListChecks,
  memory: Brain,
  memory_search: Brain,
  pebble_react: Smile,
  react_to_message: Smile,
  pebble_open_document: FileText,
  pebble_voice_setup: Mic,
};

/** Classify the declared operation, never guess from private input/output text. */
export function toolIcon(name: string): LucideIcon {
  const operation =
    name
      .trim()
      .toLowerCase()
      .split(/__|[.:/]/)
      .at(-1) ?? '';
  return icons[operation] ?? Wrench;
}
export function toolGroupIcon(names: readonly string[]): LucideIcon {
  const first = names[0] ? toolIcon(names[0]) : Wrench;
  return names.every((name) => toolIcon(name) === first) ? first : Wrench;
}
