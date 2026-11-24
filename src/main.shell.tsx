import { createRoot } from 'react-dom/client';
import { ParadiseRouter } from './app/shell/router';
import { installPbkDeployGuard } from './app/utils/deployVersion';
import { hydratePbkPrefsBeforeRender } from './app/utils/uiPrefs';
import './styles/index.css';

/**
 * Mounts PBK Center for default staff routes. The optional legacy shell is
 * built and loaded separately.
 *
 * To preview the shell locally:
 *   open http://localhost:5173/index.shell.html
 */
installPbkDeployGuard();
hydratePbkPrefsBeforeRender();
createRoot(document.getElementById('root')!).render(<ParadiseRouter />);
