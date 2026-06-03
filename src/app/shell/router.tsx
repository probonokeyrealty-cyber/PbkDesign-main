import { lazy } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ParadiseLayout } from './ParadiseLayout';

const CommandCenter = lazy(() =>
  import('../routes/CommandCenter').then((module) => ({ default: module.CommandCenter }))
);
const Leads = lazy(() => import('../routes/Leads').then((module) => ({ default: module.Leads })));
const DealView = lazy(() =>
  import('../routes/DealView').then((module) => ({ default: module.DealView }))
);
const Inbox = lazy(() => import('../routes/Inbox').then((module) => ({ default: module.Inbox })));
const Settings = lazy(() =>
  import('../routes/Settings').then((module) => ({ default: module.Settings }))
);
const AgentFleet = lazy(() =>
  import('../routes/AgentFleet').then((module) => ({ default: module.AgentFleet }))
);
const MemoryAnalytics = lazy(() =>
  import('../routes/MemoryAnalytics').then((module) => ({ default: module.MemoryAnalytics }))
);
const Analytics = lazy(() =>
  import('../routes/Analytics').then((module) => ({ default: module.Analytics }))
);

const shellBasename =
  typeof window !== 'undefined' &&
  (window.location.pathname.endsWith('/index.shell.html') || window.location.pathname.includes('/index.shell.html/'))
    ? '/index.shell.html'
    : undefined;

const router = createBrowserRouter([
  {
    path: '/',
    Component: ParadiseLayout,
    children: [
      { index: true, element: <CommandCenter /> },
      { path: 'leads', element: <Leads /> },
      { path: 'deal', element: <DealView /> },
      { path: 'deal/:id', element: <DealView /> },
      { path: 'inbox', element: <Inbox /> },
      { path: 'fleet', element: <AgentFleet /> },
      { path: 'memory', element: <MemoryAnalytics /> },
      { path: 'analytics', element: <Analytics /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
], shellBasename ? { basename: shellBasename } : undefined);

/** ParadiseRouter — top-level router used by `main.shell.tsx`. */
export function ParadiseRouter() {
  return <RouterProvider router={router} />;
}
