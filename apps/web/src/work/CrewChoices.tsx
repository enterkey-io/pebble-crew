import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import type { Organization } from '../ui/organization';
function toggle(values: string[], id: string) {
  return values.includes(id) ? values.filter((v) => v !== id) : [...values, id];
}
export function CrewChoices({
  organization,
  value,
  onChange,
  disabled = false,
}: {
  disabled?: boolean;
  organization: Organization;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <fieldset className="grid gap-3" disabled={disabled}>
      <legend className="mb-3 text-sm font-medium">Crews</legend>
      {value
        .filter((id) => !organization.crews.some((crew) => crew.id === id))
        .map((id) => (
          <Label key={id} className="flex items-center gap-3 font-normal">
            <Checkbox
              checked
              onCheckedChange={() => onChange(value.filter((value) => value !== id))}
            />
            Unavailable crew
          </Label>
        ))}
      {organization.crews.length ? (
        organization.crews.map((crew) => (
          <Label key={crew.id} className="flex items-center gap-3 font-normal">
            <Checkbox
              checked={value.includes(crew.id)}
              onCheckedChange={() => onChange(toggle(value, crew.id))}
            />
            {crew.name}
          </Label>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">No crews yet.</p>
      )}
    </fieldset>
  );
}
