import { createRoot } from 'react-dom/client';
import { ParadiseRouter } from './app/shell/router';
import './styles/index.css';

/**
 * main.shell.tsx — parallel entry that mounts the Paradise shell.
 *
 * The original `main.tsx` (which mounts `<App />` directly) is intentionally
 * left untouched. Production deploy continues to use `index.html` + `main.tsx`
 * until the shell is fully wired and we're ready to flip the default.
 *
 * To preview the shell locally:
 *   open http://localhost:5173/index.shell.html
 */
createRoot(document.getElementById('root')!).render(<ParadiseRouter />);
