import { createSlice, PayloadAction } from '@reduxjs/toolkit';

/** A pin dropped on a feature, anchored down to the ground (z = 0). */
export interface Pin {
  id: string;
  lng: number;
  lat: number;
  alt: number;      // feature elevation the pin head sits at (meters / Z units)
  label: string;
}

interface PinState {
  /** When true, map clicks drop pins instead of driving the prism explorer. */
  pinMode: boolean;
  pins: Pin[];
}

const initialState: PinState = {
  pinMode: false,
  pins: [],
};

let pinCounter = 0;

const pinSlice = createSlice({
  name: 'pin',
  initialState,
  reducers: {
    setPinMode(state, action: PayloadAction<boolean>) {
      state.pinMode = action.payload;
    },
    togglePinMode(state) {
      state.pinMode = !state.pinMode;
    },
    addPin: {
      reducer(state, action: PayloadAction<Pin>) {
        state.pins.push(action.payload);
      },
      prepare(pin: Omit<Pin, 'id'>) {
        return { payload: { ...pin, id: `pin-${pinCounter++}` } };
      },
    },
    removePin(state, action: PayloadAction<string>) {
      state.pins = state.pins.filter(p => p.id !== action.payload);
    },
    clearPins(state) {
      state.pins = [];
    },
  },
});

export const { setPinMode, togglePinMode, addPin, removePin, clearPins } = pinSlice.actions;
export default pinSlice.reducer;
