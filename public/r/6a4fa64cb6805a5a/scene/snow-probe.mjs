export async function benchmarkSnow(lab) {
  const results=[];
  lab.pose('feet');
  for(const enabled of [false,true]){
    lab.setEnabled(enabled);
    const samples=[];
    let previous=performance.now();
    for(let frame=0;frame<26;frame++){
      await new Promise(requestAnimationFrame);
      lab.draw();
      const now=performance.now();
      if(frame>=6)samples.push(now-previous);
      previous=now;
    }
    samples.sort((first,second)=>first-second);
    results.push({enabled,frames:samples.length,medianMs:samples[10],p95Ms:samples[19],render:{...lab.renderer.info.render}});
  }
  const context=lab.renderer.getContext(),extension=context.getExtension('WEBGL_debug_renderer_info');
  const report={results,resolution:[lab.renderer.domElement.width,lab.renderer.domElement.height],gpu:extension?context.getParameter(extension.UNMASKED_RENDERER_WEBGL):'unknown',camera:lab.camera.position.toArray(),target:lab.orbit.target.toArray(),surfaceBudget:lab.surface.budget,note:'Same stationary camera; 6 warm-up + 20 sampled requestAnimationFrame intervals per mode. Software GPU results do not establish hardware frame rate.'};
  window.snowBenchmark=report;
  return report;
}
