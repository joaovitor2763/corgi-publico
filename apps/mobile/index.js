import "react-native-get-random-values";
import "@copilotkit/react-native/polyfills";
import { registerRootComponent } from "expo";
import { createElement } from "react";
import App from "./App";
import { CrashScreen } from "./src/shared/crash-screen";
import { fitToVisibleArea } from "./src/shared/keyboard-fit";

fitToVisibleArea();

registerRootComponent(() => createElement(CrashScreen, null, createElement(App)));
