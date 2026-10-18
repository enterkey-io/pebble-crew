import { useId, useState } from 'react';
import { Bold, Italic, Plus, Search } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { ButtonGroup } from '../../components/ui/button-group';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Checkbox } from '../../components/ui/checkbox';
import { Switch } from '../../components/ui/switch';
import { Slider } from '../../components/ui/slider';
import { Toggle } from '../../components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
import { Field, FieldLabel, FieldError } from '../../components/ui/field';
import { Label } from '../../components/ui/label';
import { Form } from '../../components/ui/form';
import { Combobox } from '../../components/ui/combobox';
import { NumberField } from '../../components/ui/number-field';
import { TagsInput } from '../../components/ui/tags-input';
import { Calendar } from '../../components/ui/calendar';
import { DatePicker } from '../../components/ui/date-picker';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '../../components/ui/input-otp';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../../components/ui/select';
import { InputGroup, InputGroupInput, InputGroupAddon } from '../../components/ui/input-group';
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
} from '../../components/ui/command';
import {
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireTitle,
  QuestionnaireChoices,
  QuestionnaireChoice,
  QuestionnaireActions,
  QuestionnaireSubmit,
} from '../../components/ui/questionnaire';
import type { SpecimenProps } from '../specimen-types';
import type { DateRange } from 'react-day-picker';

function TextControl({
  mode,
  kind,
}: SpecimenProps & { kind: 'input' | 'textarea' | 'field' | 'label' | 'form' }) {
  const id = useId();
  const [value, setValue] = useState('Aurora');
  const [saved, setSaved] = useState(false);
  const field = (
    <Field data-invalid={mode === 'error'}>
      <FieldLabel htmlFor={id}>Name</FieldLabel>
      {kind === 'textarea' ? (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={mode === 'disabled'}
          aria-invalid={mode === 'error'}
          aria-describedby={mode === 'error' ? `${id}-error` : undefined}
        />
      ) : (
        <Input
          id={id}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={mode === 'disabled'}
          aria-invalid={mode === 'error'}
          aria-describedby={mode === 'error' ? `${id}-error` : undefined}
        />
      )}
      {mode === 'error' && <FieldError id={`${id}-error`}>Enter a unique name.</FieldError>}
    </Field>
  );
  return kind === 'form' ? (
    <Form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(true);
      }}
    >
      {field}
      <Button disabled={mode === 'disabled'}>Save</Button>
      <span role="status">{saved ? 'Saved locally' : ''}</span>
    </Form>
  ) : (
    field
  );
}
function Choices({
  mode,
  kind,
}: SpecimenProps & { kind: 'checkbox' | 'switch' | 'radio-group' | 'toggle' | 'toggle-group' }) {
  const id = useId();
  const [checked, setChecked] = useState(true);
  const [value, setValue] = useState('compact');
  const disabled = mode === 'disabled';
  if (kind === 'toggle')
    return (
      <Toggle aria-label="Bold" pressed={checked} onPressedChange={setChecked} disabled={disabled}>
        <Bold />
      </Toggle>
    );
  if (kind === 'toggle-group')
    return (
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={setValue}
        disabled={disabled}
        aria-label="Text style"
      >
        <ToggleGroupItem value="bold" aria-label="Bold">
          <Bold />
        </ToggleGroupItem>
        <ToggleGroupItem value="italic" aria-label="Italic">
          <Italic />
        </ToggleGroupItem>
      </ToggleGroup>
    );
  if (kind === 'radio-group')
    return (
      <RadioGroup aria-label="Density" value={value} onValueChange={setValue} disabled={disabled}>
        {['compact', 'comfortable'].map((x) => (
          <div key={x} className="flex items-center gap-3">
            <RadioGroupItem value={x} id={`${id}-${x}`} />
            <Label htmlFor={`${id}-${x}`}>{x === 'compact' ? 'Compact' : 'Comfortable'}</Label>
          </div>
        ))}
      </RadioGroup>
    );
  return (
    <div className="flex items-center gap-3">
      {kind === 'checkbox' ? (
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={(v) => setChecked(v === true)}
          disabled={disabled}
        />
      ) : (
        <Switch id={id} checked={checked} onCheckedChange={setChecked} disabled={disabled} />
      )}
      <Label htmlFor={id}>Show notifications</Label>
    </div>
  );
}
function Picker({ mode, kind }: SpecimenProps & { kind: 'combobox' | 'select' | 'native-select' }) {
  const [value, setValue] = useState('aurora');
  const disabled = mode === 'disabled';
  const options = [
    { value: 'aurora', label: 'Aurora' },
    { value: 'grace', label: 'Grace' },
    { value: 'archived', label: 'Archived', disabled: true },
  ];
  if (kind === 'combobox')
    return (
      <Combobox
        label="Pebble"
        options={options}
        value={value}
        onValueChange={setValue}
        disabled={disabled}
      />
    );
  if (kind === 'native-select')
    return (
      <NativeSelect
        aria-label="Pebble"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
      >
        {options.map((x) => (
          <NativeSelectOption key={x.value} value={x.value} disabled={x.disabled ?? false}>
            {x.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    );
  return (
    <Select value={value} onValueChange={setValue} disabled={disabled}>
      <SelectTrigger aria-label="Pebble">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((x) => (
          <SelectItem key={x.value} value={x.value} disabled={x.disabled ?? false}>
            {x.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Numeric({ mode, kind }: SpecimenProps & { kind: 'number-field' | 'slider' }) {
  const [value, setValue] = useState<number | null>(40);
  return kind === 'slider' ? (
    <div className="grid gap-4">
      <Slider
        aria-label="Volume"
        value={[value ?? 0]}
        onValueChange={(v) => setValue(v[0] ?? 0)}
        disabled={mode === 'disabled'}
      />
      <output>{value}%</output>
    </div>
  ) : (
    <NumberField
      aria-label="Limit"
      value={value}
      onValueChange={setValue}
      min={0}
      max={100}
      disabled={mode === 'disabled'}
    />
  );
}
function Dates({
  mode,
  kind,
}: SpecimenProps & { kind: 'date-picker' | 'calendar' | 'range-calendar' }) {
  const [value, setValue] = useState<Date | undefined>(new Date(2026, 9, 17));
  const [range, setRange] = useState<DateRange | undefined>({
    from: new Date(2026, 9, 17),
    to: new Date(2026, 9, 20),
  });
  if (kind === 'date-picker')
    return (
      <DatePicker
        label="Date"
        value={value}
        onValueChange={setValue}
        disabled={mode === 'disabled'}
      />
    );
  return kind === 'calendar' ? (
    <Calendar mode="single" selected={value} onSelect={setValue} disabled={mode === 'disabled'} />
  ) : (
    <Calendar mode="range" selected={range} onSelect={setRange} disabled={mode === 'disabled'} />
  );
}
function Pin({ mode }: SpecimenProps) {
  const [value, setValue] = useState('');
  return (
    <InputOTP
      aria-label="Pairing code"
      maxLength={4}
      value={value}
      onChange={setValue}
      disabled={mode === 'disabled'}
    >
      <InputOTPGroup>
        {[0, 1, 2, 3].map((i) => (
          <InputOTPSlot key={i} index={i} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
function Tags({ mode }: SpecimenProps) {
  const [value, setValue] = useState<readonly string[]>(['Planning', 'Research']);
  return (
    <TagsInput
      label="Topics"
      value={value}
      onValueChange={setValue}
      disabled={mode === 'disabled'}
    />
  );
}
function Commands({ mode }: SpecimenProps) {
  const [value, setValue] = useState('');
  return (
    <Command>
      <CommandInput
        placeholder="Search"
        aria-label="Search examples"
        disabled={mode === 'disabled'}
      />
      <CommandList>
        <CommandEmpty>None</CommandEmpty>
        <CommandGroup heading="Pebbles">
          {['Aurora', 'Grace'].map((x) => (
            <CommandItem key={x} onSelect={() => setValue(x)}>
              {x}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      <span role="status" className="p-3 text-sm text-muted-foreground">
        {value}
      </span>
    </Command>
  );
}
function Questions({ mode }: SpecimenProps) {
  const [saved, setSaved] = useState(false);
  return (
    <Questionnaire
      items={[{ name: 'format', choices: [{ value: 'brief' }, { value: 'detailed' }] }]}
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(true);
      }}
    >
      <QuestionnaireItem name="format" disabled={mode === 'disabled'}>
        <QuestionnaireTitle>How much detail?</QuestionnaireTitle>
        <QuestionnaireChoices>
          <QuestionnaireChoice value="brief">Brief</QuestionnaireChoice>
          <QuestionnaireChoice value="detailed">Detailed</QuestionnaireChoice>
        </QuestionnaireChoices>
        <QuestionnaireActions>
          <QuestionnaireSubmit>Continue</QuestionnaireSubmit>
        </QuestionnaireActions>
      </QuestionnaireItem>
      <span role="status">{saved ? 'Choice saved locally' : ''}</span>
    </Questionnaire>
  );
}
export const controlSpecimens = {
  input: (p: SpecimenProps) => <TextControl {...p} kind="input" />,
  textarea: (p: SpecimenProps) => <TextControl {...p} kind="textarea" />,
  field: (p: SpecimenProps) => <TextControl {...p} kind="field" />,
  label: (p: SpecimenProps) => <TextControl {...p} kind="label" />,
  form: (p: SpecimenProps) => <TextControl {...p} kind="form" />,
  button: ({ mode }: SpecimenProps) => (
    <div className="flex flex-wrap gap-3">
      <Button disabled={mode === 'disabled'}>Save</Button>
      <Button variant="outline" disabled={mode === 'disabled'}>
        Cancel
      </Button>
      <Button variant="quiet" aria-label="Add" disabled={mode === 'disabled'}>
        <Plus />
      </Button>
    </div>
  ),
  'button-group': ({ mode }: SpecimenProps) => (
    <ButtonGroup aria-label="File actions">
      <Button variant="outline" disabled={mode === 'disabled'}>
        Open
      </Button>
      <Button variant="outline" disabled={mode === 'disabled'}>
        Download
      </Button>
    </ButtonGroup>
  ),
  checkbox: (p: SpecimenProps) => <Choices {...p} kind="checkbox" />,
  switch: (p: SpecimenProps) => <Choices {...p} kind="switch" />,
  'radio-group': (p: SpecimenProps) => <Choices {...p} kind="radio-group" />,
  toggle: (p: SpecimenProps) => <Choices {...p} kind="toggle" />,
  'toggle-group': (p: SpecimenProps) => <Choices {...p} kind="toggle-group" />,
  combobox: (p: SpecimenProps) => <Picker {...p} kind="combobox" />,
  select: (p: SpecimenProps) => <Picker {...p} kind="select" />,
  'native-select': (p: SpecimenProps) => <Picker {...p} kind="native-select" />,
  'number-field': (p: SpecimenProps) => <Numeric {...p} kind="number-field" />,
  slider: (p: SpecimenProps) => <Numeric {...p} kind="slider" />,
  calendar: (p: SpecimenProps) => <Dates {...p} kind="calendar" />,
  'range-calendar': (p: SpecimenProps) => <Dates {...p} kind="range-calendar" />,
  'date-picker': (p: SpecimenProps) => <Dates {...p} kind="date-picker" />,
  'input-otp': Pin,
  'pin-input': Pin,
  'tags-input': Tags,
  command: Commands,
  questionnaire: Questions,
  'input-group': ({ mode }: SpecimenProps) => (
    <InputGroup>
      <InputGroupAddon>
        <Search aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput aria-label="Search" placeholder="Search" disabled={mode === 'disabled'} />
    </InputGroup>
  ),
};
