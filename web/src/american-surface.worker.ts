import { americanSurface } from "./american-surface";

self.onmessage = event => {
  try { self.postMessage({ result: americanSurface(event.data.state, event.data.range) }); }
  catch { self.postMessage({ error: "American surface unavailable for these inputs." }); }
};
