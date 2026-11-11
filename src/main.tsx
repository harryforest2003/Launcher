import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import HoverTips from './components/HoverTips.tsx'
import LeaveBlockbenchPrompt from './components/LeaveBlockbenchPrompt.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <HoverTips />
    <LeaveBlockbenchPrompt />
  </StrictMode>,
)
