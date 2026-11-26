import { useId } from 'react';
import { FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import type { CountryOption } from '../types/inbound';
import { FlagOptionLabel } from '../utils/flags';

interface CountryFlagSelectProps {
  countries: CountryOption[];
  value: string;
  onChange: (value: string) => void;
  inheritLabel: string;
  inheritedFlag?: string;
}

export function CountryFlagSelect({
  countries,
  value,
  onChange,
  inheritLabel,
  inheritedFlag,
}: CountryFlagSelectProps) {
  const labelId = useId();
  const selected = countries.find((country) => country.emoji === value);
  const inherited = countries.find((country) => country.emoji === inheritedFlag);

  return (
    <FormControl size="small" fullWidth sx={{ minWidth: 0 }}>
      <InputLabel id={labelId} shrink>
        Флаг
      </InputLabel>
      <Select
        labelId={labelId}
        label="Флаг"
        displayEmpty
        value={value}
        onChange={(event) => onChange(event.target.value)}
        renderValue={(flag) => (
          <FlagOptionLabel
            flag={flag || inheritedFlag}
            code={flag ? selected?.code : inherited?.code}
            label={flag ? selected?.name || 'Флаг' : inheritLabel}
          />
        )}
      >
        <MenuItem value="">
          <FlagOptionLabel flag={inheritedFlag} code={inherited?.code} label={inheritLabel} />
        </MenuItem>
        {value && !selected && (
          <MenuItem value={value} sx={{ display: 'none' }}>
            <FlagOptionLabel flag={value} label={value} />
          </MenuItem>
        )}
        {countries.map((country) => (
          <MenuItem key={country.code} value={country.emoji}>
            <FlagOptionLabel flag={country.emoji} code={country.code} label={country.name} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
