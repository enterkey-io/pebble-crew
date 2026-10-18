import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Button } from './button';
import { Calendar } from './calendar';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export function DatePicker({
  label,
  value,
  onValueChange,
  disabled = false,
}: {
  label: string;
  value: Date | undefined;
  onValueChange: (date: Date | undefined) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={label}
          className="justify-start font-normal"
        >
          <CalendarDays aria-hidden="true" />
          {value
            ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(value)
            : 'Choose date'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(date) => {
            onValueChange(date);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
