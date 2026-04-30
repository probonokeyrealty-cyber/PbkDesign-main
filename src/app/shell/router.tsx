import { createBrowserRouter, RouterProvider } from 'react-router';
import { ParadiseLayout } from './ParadiseLayout';
import { CommandCenter } from '../routes/CommandCenter';
import { Leads } from '../routes/Leads';
import { DealView } from '../routes/DealView';
import { Inbox } from '../routes/Inbox';
import { Settings } from '../routes/Settings';

const shellBasename =
  typeof window !== 'undefined' && window.location.pathname.endsWith('/index.shell.html')
    ? '/index.shell.html'
    : undefined;

const router = createBrowserRouter([
  {
    path: '/',
    Component: ParadiseLayout,
    children: [
      { index: true, Component: CommandCenter },
      { path: 'leads', Component: Leads },
      { path: 'deal', Component: DealView },
      { path: 'deal/:id', Component: DealView },
      { path: 'inbox', Component: Inbox },
      { path: 'settings', Component: Settings },
    ],
  },
], shellBasename ? { basename: shellBasename } : undefined);

/** ParadiseRouter — top-level router used by `main.shell.tsx`. */
export function ParadiseRouter() {
  return <RouterProvider router={router} />;
}
