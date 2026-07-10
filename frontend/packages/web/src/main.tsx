import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './styles.css'
import { App } from './app.tsx'
import { InboxPage } from './pages/inbox.tsx'
import { PortfolioPage } from './pages/portfolio.tsx'
import { RunPage } from './pages/run.tsx'
import { MetricsPage } from './pages/metrics.tsx'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true } },
})

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <InboxPage /> },
      { path: 'portfolio', element: <PortfolioPage /> },
      { path: 'metrics', element: <MetricsPage /> },
      { path: 'runs/:src/:slug', element: <RunPage /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
