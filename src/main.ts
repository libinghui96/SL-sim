import './style.css';
import { LocoSim } from './sim/loco';
import { d51Params } from './sim/params';
import { Panel, type AppState } from './view/panel';
import { LocoView } from './view/scene';

const sim = new LocoSim(structuredClone(d51Params));
const state: AppState = { paused: false, timeScale: 1 };
const view = new LocoView(document.getElementById('view')!, sim);
const panel = new Panel(sim, view, state);

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!state.paused) sim.advance(dt * state.timeScale);
  view.update(dt);
  panel.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
