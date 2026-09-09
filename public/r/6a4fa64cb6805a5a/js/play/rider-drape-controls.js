export function mountDrapeControls(controller) {
  document.getElementById('rider-drape-review')?.remove();
  const panel = document.createElement('aside');
  panel.id = 'rider-drape-review';
  panel.style.cssText = 'position:fixed;bottom:18px;left:18px;z-index:100000;background:#15232eef;color:#eef4f8;padding:14px;border:1px solid #8296a6;border-radius:8px;font:13px/1.5 system-ui;max-width:310px;pointer-events:auto';
  const title = document.createElement('strong');
  title.textContent = 'Hem + hood cloth simulation';
  const status = document.createElement('div');
  status.setAttribute('aria-live', 'off');
  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;gap:6px;margin:10px 0;flex-wrap:wrap';
  const addButton = (label, action) => {
    const button = document.createElement('button');
    button.textContent = label;
    button.style.cssText = 'background:#d1e4f0;color:#15232e;border:0;padding:8px;cursor:pointer;border-radius:4px';
    button.addEventListener('click', event => { event.stopPropagation(); action(button); });
    buttons.appendChild(button);
  };
  addButton('Cloth: on', button => { controller.setEnabled(!controller.state.enabled); button.textContent = `Cloth: ${controller.state.enabled ? 'on' : 'off'}`; });
  addButton('Test crosswind', () => { window.__player?.enter?.(); window.__player?.paused(false); controller.setWind(12, 0, 0); });
  addButton('Still air', () => controller.setWind(0, 0, 0));
  const note = document.createElement('small');
  note.textContent = 'Crosswind is a review stimulus. Cloth also reacts to skiing acceleration. Upper seams stay pinned; this is not full-garment cloth simulation.';
  panel.append(title, status, buttons, note);
  document.body.appendChild(panel);
  const timer = setInterval(() => {
    if (!panel.isConnected) { clearInterval(timer); return; }
    status.textContent = `${controller.state.nodes} nodes · ${(controller.state.maxDisplacementM * 1000).toFixed(1)} mm motion · ${controller.state.wind[0]} m/s crosswind`;
  }, 200);
  return () => { clearInterval(timer); panel.remove(); };
}
