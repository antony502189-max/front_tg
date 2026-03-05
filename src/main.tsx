import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { TelegramProvider } from './telegram/TelegramProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TelegramProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </TelegramProvider>
  </StrictMode>,
)
