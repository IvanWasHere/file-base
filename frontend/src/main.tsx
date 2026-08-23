import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import { App } from './App'
import { baseThemeFor } from './constants/palette'
import { applyTheme } from './services/theme/theme'

const container = document.getElementById('root')
if (!container) throw new Error('#root element is missing from index.html')

/*
 * Paint the default palette before React renders (PLAN.md §M24).
 *
 * Since the palettes moved out of CSS and became data, no stylesheet declares a
 * colour — so between the document loading and `startThemeSync` running there
 * would be a frame with every `var(--bg-*)` unresolved. This closes it. The
 * stored preference is in SQLite and is not readable synchronously, so the
 * first frame is the default theme whatever the stored value is; it matches
 * `BackgroundColour` in main.go, which Go picks before the frontend exists.
 */
applyTheme(baseThemeFor('dark'))

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
