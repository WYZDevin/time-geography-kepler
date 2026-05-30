import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { Provider } from 'react-redux'
import store from './stores/store.tsx'
import { ColorProvider } from './contexts/color-context.tsx'
import { loadProject } from './services/persistence-service'
import { loadProjectData } from './stores/data-slice'
import './index.css'

if (import.meta.env.DEV) {
  (window as Window & { __REDUX_STORE__?: typeof store }).__REDUX_STORE__ = store;
}

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
