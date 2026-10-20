import { useId, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from './button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './command';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export type ComboboxOption = {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
};
export function Combobox({
  label,
  options,
  value,
  onValueChange,
  disabled = false,
  placeholder = 'Choose',
}: {
  label: string;
  options: readonly ComboboxOption[];
  value: string | null;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {options.find((option) => option.value === value)?.label ?? placeholder}
          </span>
          <ChevronsUpDown aria-hidden="true" className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="Search" aria-label={`Search ${label}`} />
          <CommandList id={listId}>
            <CommandEmpty>None</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  keywords={[option.label]}
                  disabled={option.disabled ?? false}
                  onSelect={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="flex-1 truncate">{option.label}</span>
                  {value === option.value && <Check aria-hidden="true" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
