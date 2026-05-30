import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import { hydratePbkPrefsBeforeRender } from "./app/utils/uiPrefs";
import "./styles/index.css";

hydratePbkPrefsBeforeRender();
createRoot(document.getElementById("root")!).render(<App />);
