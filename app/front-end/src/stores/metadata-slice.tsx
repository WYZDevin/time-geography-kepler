import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { FeatureCollection } from '../interfaces/data-interfaces';

interface Field {
  name: string;
  type: string;
}

// Define the shape of our metadata state
interface MetadataState {
  geojson: FeatureCollection | null;
  columns: Field[];
  dataLength: number;
  sideLength: number;
  // heightScale is the scale of the height of the data to match the STKDE and Axes
  heightScale: number;
}

const initialMetadataState: MetadataState = {
  geojson: null,
  columns: [],
  dataLength: 0,
  sideLength: 0,
  heightScale: 1,
};

// Slice definition
const metadataSlice = createSlice({
  name: 'metadata',
  initialState: initialMetadataState,
  reducers: {
    setGeojson: (state, action: PayloadAction<FeatureCollection>) => {
      state.geojson = action.payload;
    },
    setColumns: (state, action: PayloadAction<Field[]>) => {
      state.columns = action.payload;
    },
    setSideLength: (state, action: PayloadAction<number>) => {
      state.sideLength = action.payload;
    },
    setHeightScale: (state, action: PayloadAction<number>) => {
      state.heightScale = action.payload;
    },
    setDataLength: (state, action: PayloadAction<number>) => {
      state.dataLength = action.payload;
    }
  }
});

// Export actions and reducer
export const { setGeojson, setColumns, setSideLength, setHeightScale, setDataLength } = metadataSlice.actions;
export default metadataSlice.reducer;

// Selectors to access state from components
export const selectGeojson = (state: { metadata: MetadataState }) => state.metadata.geojson;
export const selectColumns = (state: { metadata: MetadataState }) => state.metadata.columns;
export const selectSideLength = (state: { metadata: MetadataState }) => state.metadata.sideLength;
export const selectHeightScale = (state: { metadata: MetadataState }) => state.metadata.heightScale;
export const selectDataLength = (state: { metadata: MetadataState }) => state.metadata.dataLength;