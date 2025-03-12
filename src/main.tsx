import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Provider } from 'react-redux'
import store from './store.tsx'
import { ColorProvider } from './contexts/color-context.tsx'
// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <ColorProvider>
        <App />
      </ColorProvider>
    </Provider>
  </StrictMode>,
)
