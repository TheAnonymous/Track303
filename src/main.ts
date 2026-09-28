import { createApp } from "vue";
import App from "./App.vue";
import "./styles.css";

createApp(App).mount("#app");

// Offline renders for the automated tests; only on this machine and only on request.
const audioTestRequested = new URLSearchParams(window.location.search).get("audio-test") === "1";
const localHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(window.location.hostname);
if (audioTestRequested && localHost) {
  void import("./sound/offline-test").then(({ installAudioTestApi }) => installAudioTestApi());
}
