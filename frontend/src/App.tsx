import { AppProviders } from '@/app/providers/AppProviders'
import { ExplorerLayout } from '@/app/layouts/ExplorerLayout'

export function App() {
  return (
    <AppProviders>
      <ExplorerLayout />
    </AppProviders>
  )
}
