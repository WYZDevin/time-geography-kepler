import { useState, useCallback } from 'react';
import { HexColorPicker } from 'react-colorful';
import * as Popover from '@radix-ui/react-popover';

interface ColorPickerProps {
  color: [number, number, number];
  onChange: (color: [number, number, number]) => void;
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return null;
  const n = parseInt(clean, 16);
  if (isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const ColorPicker: React.FC<ColorPickerProps> = ({ color, onChange }) => {
  const hex = rgbToHex(color);
  const [inputVal, setInputVal] = useState(hex);

  const handlePickerChange = useCallback((newHex: string) => {
    setInputVal(newHex);
    const rgb = hexToRgb(newHex);
    if (rgb) onChange(rgb);
  }, [onChange]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value;
    setInputVal(val);
    const rgb = hexToRgb(val);
    if (rgb) onChange(rgb);
  };

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className="w-6 h-6 rounded border border-gray-300 shadow-sm cursor-pointer flex-shrink-0 hover:ring-2 hover:ring-offset-1 hover:ring-blue-400 transition-all"
          style={{ backgroundColor: rgbToHex(color) }}
          title="Pick color"
        />
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="right"
          sideOffset={8}
          className="z-50 rounded-xl shadow-xl border border-gray-200 bg-white p-3 flex flex-col gap-2"
          onOpenAutoFocus={e => e.preventDefault()}
        >
          <HexColorPicker color={rgbToHex(color)} onChange={handlePickerChange} />

          {/* Hex input */}
          <div className="flex items-center gap-1.5 mt-1">
            <div
              className="w-5 h-5 rounded border border-gray-200 flex-shrink-0"
              style={{ backgroundColor: rgbToHex(color) }}
            />
            <input
              type="text"
              value={inputVal}
              onChange={handleInputChange}
              onFocus={e => e.target.select()}
              maxLength={7}
              className="flex-1 text-xs font-mono border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="#rrggbb"
            />
          </div>

          <Popover.Arrow className="fill-white stroke-gray-200" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
