import { createRoot } from 'react-dom/client';
import App from './app/App.tsx';
import { installPbkDeployGuard } from './app/utils/deployVersion';
import { hydratePbkPrefsBeforeRender } from './app/utils/uiPrefs';
import './styles/index.css';

installPbkDeployGuard();
hydratePbkPrefsBeforeRender();
createRoot(document.getElementById('root')!).render(<App />);
