import { createRoot } from 'react-dom/client';
import { ParadiseRouter } from './app/shell/router';
import { installPbkDeployGuard } from './app/utils/deployVersion';
import { hydratePbkPrefsBeforeRender } from './app/utils/uiPrefs';
import './styles/index.css';

/**
 * main.shell.tsx — parallel entry that mounts the Paradise shell.
 *
 * The original `main.tsx` (which mounts `<App />` directly) remains available
 * for the legacy dashboard artifact. Netlify clean shell routes now rewrite to
 * this entry so the modern shell can own the production dashboard surface.
 *
 * To preview the shell locally:
 *   open http://localhost:5173/index.shell.html
 */
installPbkDeployGuard();
hydratePbkPrefsBeforeRender();
createRoot(document.getElementById('root')!).render(<ParadiseRouter />);
