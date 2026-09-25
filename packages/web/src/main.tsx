import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './styles.css'
import { App } from './app.tsx'
import { InboxPage } from './pages/inbox.tsx'
import { MetricsPage } from './pages/metrics.tsx'
import { NewRunPage } from './pages/new-run.tsx'
import { PortfolioPage } from './pages/portfolio.tsx'
import { RunPage } from './pages/run.tsx'
import { routerBasename } from './static-mode.ts'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true } },
})

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <App />,
      children: [
        { index: true, element: <InboxPage /> },
        { path: 'portfolio', element: <PortfolioPage /> },
        { path: 'portfolio/new', element: <NewRunPage /> },
        { path: 'metrics', element: <MetricsPage /> },
        { path: 'runs/:src/:slug', element: <RunPage /> },
      ],
    },
  ],
  { basename: routerBasename() },
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
