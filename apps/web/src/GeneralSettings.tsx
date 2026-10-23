import { Button } from './components/ui/button';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Label } from './components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from './components/ui/item';
import { useAppearance } from './ui/AppearanceProvider';

export function GeneralSettings({ onProactive }: { onProactive?: (() => void) | undefined }) {
  const { mode, setMode } = useAppearance();
  return (
    <section aria-label="General settings">
      <Item className="flex-nowrap px-0">
        <ItemContent>
          <ItemTitle>
            <Label htmlFor="appearance-mode">Appearance</Label>
          </ItemTitle>
          <ItemDescription>System follows your device’s light or dark mode.</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Select
            value={mode}
            onValueChange={(value) => {
              if (value === 'light' || value === 'dark' || value === 'system') setMode(value);
            }}
          >
            <SelectTrigger id="appearance-mode" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">
                <Monitor />
                System
              </SelectItem>
              <SelectItem value="light">
                <Sun />
                Light
              </SelectItem>
              <SelectItem value="dark">
                <Moon />
                Dark
              </SelectItem>
            </SelectContent>
          </Select>
        </ItemActions>
      </Item>
      {onProactive && (
        <Item className="flex-nowrap px-0">
          <ItemContent>
            <ItemTitle>Proactive help</ItemTitle>
            <ItemDescription>Choose routines for your Main Pebble.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button variant="secondary" onClick={onProactive}>
              Set up
            </Button>
          </ItemActions>
        </Item>
      )}
    </section>
  );
}
