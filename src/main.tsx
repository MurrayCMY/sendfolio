import { render } from "preact";
import "@fontsource/jost/400.css";
import "@fontsource/jost/500.css";
import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/500.css";
import "./styles.css";
import { App } from "./app";
import { loadConfig } from "./i18n";

// Brand name, default language and time zone come from the server before the first render.
loadConfig().finally(() => render(<App />, document.getElementById("app")!));
