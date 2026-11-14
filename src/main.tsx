import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { startTheme } from './theme/runtime.ts'
import './index.css'
import './App.css'
import App from './App.tsx'
import HoverTips from './components/HoverTips.tsx'
import LeaveBlockbenchPrompt from './components/LeaveBlockbenchPrompt.tsx'

// The user's colours go on before anything is drawn, so the launcher never flashes the default.
startTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <HoverTips />
    <LeaveBlockbenchPrompt />
  </StrictMode>,
)
