import { lazy } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ParadiseLayout } from './ParadiseLayout';
import { NotFound } from '../routes/NotFound';

const CommandCenter = lazy(() =>
  import('../routes/CommandCenter').then((module) => ({ default: module.CommandCenter }))
);
const Leads = lazy(() => import('../routes/Leads').then((module) => ({ default: module.Leads })));
const LeadPortal = lazy(() =>
  import('../routes/LeadPortal').then((module) => ({ default: module.LeadPortal }))
);
const DealView = lazy(() =>
  import('../routes/DealView').then((module) => ({ default: module.DealView }))
);
const Inbox = lazy(() => import('../routes/Inbox').then((module) => ({ default: module.Inbox })));
const UnifiedInbox = lazy(() =>
  import('../routes/UnifiedInbox').then((module) => ({ default: module.UnifiedInbox }))
);
const Settings = lazy(() =>
  import('../routes/Settings').then((module) => ({ default: module.Settings }))
);
const AgentFleet = lazy(() =>
  import('../routes/AgentFleet').then((module) => ({ default: module.AgentFleet }))
);
const MemoryAnalytics = lazy(() =>
  import('../routes/MemoryAnalytics').then((module) => ({ default: module.MemoryAnalytics }))
);
const SkillStudio = lazy(() =>
  import('../routes/SkillStudio').then((module) => ({ default: module.SkillStudio }))
);
const Analytics = lazy(() =>
  import('../routes/Analytics').then((module) => ({ default: module.Analytics }))
);
const Campaigns = lazy(() =>
  import('../routes/Campaigns').then((module) => ({ default: module.Campaigns }))
);
const AvaChat = lazy(() =>
  import('../routes/AvaChat').then((module) => ({ default: module.AvaChat }))
);

const shellBasename =
  typeof window !== 'undefined' &&
  (window.location.pathname.endsWith('/index.shell.html') ||
    window.location.pathname.includes('/index.shell.html/'))
    ? '/index.shell.html'
    : undefined;

const router = createBrowserRouter(
  [
    {
      path: '/',
      Component: ParadiseLayout,
      children: [
        { index: true, element: <CommandCenter /> },
        { path: 'command-center', element: <CommandCenter /> },
        { path: 'dashboard', element: <CommandCenter /> },
        { path: 'leads', element: <Leads /> },
        { path: 'leads/:leadId', element: <LeadPortal /> },
        { path: 'deal', element: <DealView /> },
        { path: 'deal/:id', element: <DealView /> },
        { path: 'inbox', element: <Inbox /> },
        { path: 'inbox/conversations', element: <UnifiedInbox /> },
        { path: 'fleet', element: <AgentFleet /> },
        { path: 'agents', element: <AgentFleet /> },
        { path: 'memory', element: <MemoryAnalytics /> },
        { path: 'skills', element: <SkillStudio /> },
        { path: 'skill-studio', element: <SkillStudio /> },
        { path: 'analytics', element: <Analytics /> },
        { path: 'campaigns', element: <Campaigns /> },
        { path: 'ava-chat', element: <AvaChat /> },
        { path: 'settings', element: <Settings /> },
        { path: '*', element: <NotFound /> },
      ],
    },
  ],
  shellBasename ? { basename: shellBasename } : undefined
);

/** ParadiseRouter — top-level router used by `main.shell.tsx`. */
export function ParadiseRouter() {
  return <RouterProvider router={router} />;
}
