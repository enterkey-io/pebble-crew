import type { ComponentProps } from 'react';
import { Input } from './input';

export function NumberField({
  value,
  onValueChange,
  ...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: number | null;
  onValueChange: (value: number | null) => void;
}) {
  return (
    <Input
      data-slot="number-field"
      type="number"
      value={value ?? ''}
      onChange={(event) => {
        const number = event.currentTarget.valueAsNumber;
        onValueChange(Number.isFinite(number) ? number : null);
      }}
      {...props}
    />
  );
}
