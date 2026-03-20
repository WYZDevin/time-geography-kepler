// Polyfill Node.js globals for Kepler.gl
import process from 'process';
(window as any).process = process;

import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { Provider } from 'react-redux'
import store from './stores/store.tsx'
import { ColorProvider } from './contexts/color-context.tsx'
import { loadProject } from './services/persistence-service'
import { loadProjectData } from './stores/data-slice'
import './index.css'
// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

// Load saved data on startup
const savedData = loadProject();
if (savedData) {
  store.dispatch(loadProjectData({
    dataSources: savedData.dataSources,
    selectedIds: savedData.selectedIds,
  }));
  console.log('[Persistence] Loaded saved project data');
}

createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <ColorProvider>
      <App />

    </ColorProvider>
  </Provider>,
)
