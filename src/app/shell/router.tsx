import { lazy } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ParadiseLayout } from './ParadiseLayout';
import { NotFound } from '../routes/NotFound';
import { loadCurrentRoute } from '../utils/deployVersion';

const CommandCenter = lazy(() =>
  loadCurrentRoute(() => import('../routes/CommandCenter')).then((module) => ({
    default: module.CommandCenter,
  }))
);
const Leads = lazy(() =>
  loadCurrentRoute(() => import('../routes/Leads')).then((module) => ({ default: module.Leads }))
);
const LeadPortal = lazy(() =>
  loadCurrentRoute(() => import('../routes/LeadPortal')).then((module) => ({
    default: module.LeadPortal,
  }))
);
const DealView = lazy(() =>
  loadCurrentRoute(() => import('../routes/DealView')).then((module) => ({
    default: module.DealView,
  }))
);
const Inbox = lazy(() =>
  loadCurrentRoute(() => import('../routes/Inbox')).then((module) => ({ default: module.Inbox }))
);
const UnifiedInbox = lazy(() =>
  loadCurrentRoute(() => import('../routes/UnifiedInbox')).then((module) => ({
    default: module.UnifiedInbox,
  }))
);
const Settings = lazy(() =>
  loadCurrentRoute(() => import('../routes/Settings')).then((module) => ({
    default: module.Settings,
  }))
);
const AgentFleet = lazy(() =>
  loadCurrentRoute(() => import('../routes/AgentFleet')).then((module) => ({
    default: module.AgentFleet,
  }))
);
const MemoryAnalytics = lazy(() =>
  loadCurrentRoute(() => import('../routes/MemoryAnalytics')).then((module) => ({
    default: module.MemoryAnalytics,
  }))
);
const SkillStudio = lazy(() =>
  loadCurrentRoute(() => import('../routes/SkillStudio')).then((module) => ({
    default: module.SkillStudio,
  }))
);
const Analytics = lazy(() =>
  loadCurrentRoute(() => import('../routes/Analytics')).then((module) => ({
    default: module.Analytics,
  }))
);
const Campaigns = lazy(() =>
  loadCurrentRoute(() => import('../routes/Campaigns')).then((module) => ({
    default: module.Campaigns,
  }))
);
const AvaChat = lazy(() =>
  loadCurrentRoute(() => import('../routes/AvaChat')).then((module) => ({
    default: module.AvaChat,
  }))
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
        { path: 'deals', element: <DealView /> },
        { path: 'deals/analyzer', element: <DealView /> },
        { path: 'analyzer', element: <DealView /> },
        { path: 'inbox', element: <Inbox /> },
        { path: 'inbox/conversations', element: <UnifiedInbox /> },
        { path: 'fleet', element: <AgentFleet /> },
        { path: 'agent-fleet', element: <AgentFleet /> },
        { path: 'agents', element: <AgentFleet /> },
        { path: 'memory', element: <MemoryAnalytics /> },
        { path: 'skills', element: <SkillStudio /> },
        { path: 'skill-studio', element: <SkillStudio /> },
        { path: 'analytics', element: <Analytics /> },
        { path: 'campaigns', element: <Campaigns /> },
        { path: 'agent', element: <AvaChat /> },
        { path: 'agent-console', element: <AvaChat /> },
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
