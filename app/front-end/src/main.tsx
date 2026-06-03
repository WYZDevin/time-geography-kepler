import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { Provider } from 'react-redux'
import store from './stores/store.tsx'
import { ColorProvider } from './contexts/color-context.tsx'
import { loadProject, saveProject } from './services/persistence-service'
import { loadProjectData } from './stores/data-slice'
import './index.css'

if (import.meta.env.DEV) {
  (window as Window & { __REDUX_STORE__?: typeof store }).__REDUX_STORE__ = store;
}

const renderApp = () => {
  createRoot(document.getElementById('root')!).render(
    <Provider store={store}>
      <ColorProvider>
        <App />

      </ColorProvider>
    </Provider>,
  )
}

// Hydrate saved data from IndexedDB before the first render (fast for typical
// projects; avoids a flash of empty state). Render regardless of the outcome.
loadProject()
  .then((savedData) => {
    if (savedData) {
      store.dispatch(loadProjectData({
        dataSources: savedData.dataSources,
        selectedIds: savedData.selectedIds,
      }));
      console.log('[Persistence] Loaded saved project data');
    }
  })
  .catch((error) => console.error('[Persistence] Failed to load saved data:', error))
  .finally(renderApp);

// Best-effort flush when the tab is hidden/closed, so a refresh right after an
// upload doesn't lose it if the debounced auto-save hasn't fired yet.
const flushPendingSave = () => {
  const { dataSources, selectedIds } = store.getState().data;
  void saveProject(dataSources, selectedIds).catch(() => { /* best effort */ });
};
window.addEventListener('pagehide', flushPendingSave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushPendingSave();
});
