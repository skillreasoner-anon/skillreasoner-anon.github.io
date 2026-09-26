/* All runtime and physics files are served from this anonymous site. */
importScripts('../vendor/pyodide/pyodide.js');
let py, ready=false;
const loaded=(async()=>{
  py=await loadPyodide({indexURL:new URL('../vendor/pyodide/',self.location.href).href});
  await py.loadPackage('cffi');
  const wheel=await (await fetch('../vendor/pyodide/pymunk.whl')).arrayBuffer();
  py.unpackArchive(new Uint8Array(wheel),'zip',{extractDir:'/lib/python3.12/site-packages'});
  for (const name of ['physics.py','simulation.py']) py.FS.writeFile('/home/pyodide/'+name,await (await fetch(name)).text());
  await py.runPythonAsync('from simulation import reset_task, advance');
  ready=true;postMessage({type:'ready'});
})().catch(()=>postMessage({type:'error',message:'The simulator could not load. Please reload or try a current browser.'}));
self.onmessage=async({data})=>{
  await loaded;if(!ready)return;
  try{
    const fn=py.globals.get(data.type==='reset'?'reset_task':'advance');
    const state=JSON.parse(fn(JSON.stringify(data.type==='reset'?data.task:data.target)));fn.destroy();
    postMessage({type:'state',state,generation:data.generation});
  }catch(e){postMessage({type:'error',message:'Simulation stopped. Please reset the task.'});}
};
