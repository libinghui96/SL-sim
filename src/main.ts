import './style.css';
import { LocoSim } from './sim/loco';
import { d51Params } from './sim/params';
import { Panel, type AppState } from './view/panel';
import { LocoView } from './view/scene';

const sim = new LocoSim(structuredClone(d51Params));
const state: AppState = { paused: false, timeScale: 1 };
const view = new LocoView(document.getElementById('view')!, sim);
const panel = new Panel(sim, view, state);

function tick(dt: number): void {
  if (!state.paused) sim.advance(dt * state.timeScale);
  view.update(dt);
  panel.update(dt);
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// lets automated checks step the app when the tab is hidden and requestAnimationFrame is throttled
if (import.meta.env.DEV) Object.assign(window, { slsim: { sim, view, tick } });
