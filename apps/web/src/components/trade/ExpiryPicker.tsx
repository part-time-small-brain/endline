import { expiryChips } from "../../lib/time.ts";
import { Chips } from "../Chips.tsx";
import { Field } from "./Field.tsx";

interface Props {
  expiries: number[];
  value: number | undefined;
  nowSec: number;
  onChange: (expiry: number) => void;
}

export function ExpiryPicker({ expiries, value, nowSec, onChange }: Props) {
  return (
    <Field title="Ends">
      <Chips
        label="Ends"
        columns="-mx-4 flex overflow-x-auto px-4 [scrollbar-width:none] *:w-28 *:shrink-0 lg:mx-0 lg:grid lg:grid-cols-[repeat(4,minmax(min-content,1fr))] lg:px-0 lg:*:w-auto"
        value={value?.toString()}
        onChange={(v) => onChange(Number(v))}
        options={expiryChips(expiries, nowSec).map(({ expiry, label, hint }) => ({ value: expiry.toString(), label, hint }))}
      />
    </Field>
  );
}
