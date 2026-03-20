import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface ProgressState {
  isProcessing: boolean;
  progress: number;
  status: string;
}

const initialState: ProgressState = {
  isProcessing: false,
  progress: 0,
  status: '',
};

const progressSlice = createSlice({
  name: 'progress',
  initialState,
  reducers: {
    startProcessing: (state) => {
      state.isProcessing = true;
      state.progress = 0;
      state.status = 'Starting process...';
    },
    updateProgress: (state, action: PayloadAction<{ progress: number; status: string }>) => {
      state.progress = action.payload.progress;
      state.status = action.payload.status;
    },
    completeProcessing: (state) => {
      state.progress = 100;
      state.status = 'Processing complete!';
      state.isProcessing = false;
    },
    resetProgress: (state) => {
      state.isProcessing = false;
      state.progress = 0;
      state.status = '';
    },
  },
});

export const { startProcessing, updateProgress, completeProcessing, resetProgress } = progressSlice.actions;
export default progressSlice.reducer;