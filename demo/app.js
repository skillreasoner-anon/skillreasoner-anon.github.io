'use strict';
const $=id=>document.getElementById(id), canvas=$('world'),ctx=canvas.getContext('2d');
let tasks=[],task,state,worker,ready=false,failed=false,inView=true,busy=false,resetting=false,generation=0,target=[0,0],won=false;
const keys=new Set();let held=false,lastTouch=null,inputPointer=null;
const CONTROL_MS=25, PHYSICS_STEPS=20;
const shape=[[-60,0],[60,0],[60,30],[15,30],[15,120],[-15,120],[-15,30],[-60,30]];
function polygon(pose,fill,stroke,dashed=false){ctx.save();ctx.translate(pose[0],pose[1]);ctx.rotate(pose[2]);ctx.beginPath();shape.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.setLineDash(dashed?[6,4]:[]);ctx.stroke();ctx.restore();}
function draw(){ctx.clearRect(0,0,768,768);if(!task||!state)return;ctx.save();ctx.scale(768/task.size,768/task.size);ctx.fillStyle='#fff';ctx.fillRect(0,0,task.size,task.size);polygon(task.goal,'#dae5d4','#68775c',true);ctx.fillStyle='#79848a';for(const [x,y,w,h]of task.walls)ctx.fillRect(x-w/2,y-h/2,w,h);polygon(state.block,'#a6b0b6','#596973');ctx.beginPath();ctx.arc(...state.pusher,15,0,Math.PI*2);ctx.fillStyle='#c5a47e';ctx.fill();ctx.strokeStyle='#a56a56';ctx.lineWidth=2;ctx.stroke();if(held){ctx.beginPath();ctx.arc(...target,5,0,Math.PI*2);ctx.strokeStyle='#a56a56';ctx.stroke();}ctx.restore();}
function status(t){$('status').textContent=t;}
function reset(){
  if(!ready)return;
  generation++;task={...tasks[+$('task').value],seed:crypto.getRandomValues(new Uint32Array(1))[0]};
  won=false;failed=false;keys.clear();release();$('status').classList.remove('success');busy=true;resetting=true;
  worker.postMessage({type:'reset',task,generation});status('New start and goal…');
}
function direct(e){const r=canvas.getBoundingClientRect();target=[(e.clientX-r.left)/r.width*task.size,(e.clientY-r.top)/r.height*task.size];}
canvas.addEventListener('pointerdown',e=>{if(!ready||resetting||failed||won||inputPointer!==null)return;e.preventDefault();inputPointer=e.pointerId;canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);held=true;direct(e);});
canvas.addEventListener('pointermove',e=>{if(held&&e.pointerId===inputPointer){e.preventDefault();direct(e);}});
function release(e){if(e&&e.pointerId!==inputPointer)return;held=false;lastTouch=null;inputPointer=null;$('touchpad').classList.remove('active');}
for(const el of [canvas,$('touchpad')])for(const event of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(event,release);
$('touchpad').addEventListener('pointerdown',e=>{if(!ready||resetting||failed||won||inputPointer!==null)return;e.preventDefault();inputPointer=e.pointerId;$('touchpad').focus({preventScroll:true});$('touchpad').setPointerCapture(e.pointerId);lastTouch=[e.clientX,e.clientY];target=state.pusher.slice();$('touchpad').classList.add('active');});
$('touchpad').addEventListener('pointermove',e=>{if(!lastTouch||e.pointerId!==inputPointer)return;e.preventDefault();const gain=task.size/canvas.getBoundingClientRect().width;target=[target[0]+(e.clientX-lastTouch[0])*gain,target[1]+(e.clientY-lastTouch[1])*gain].map(x=>Math.max(task.bounds[0]+15,Math.min(task.bounds[1]-15,x)));lastTouch=[e.clientX,e.clientY];});
for(const el of [canvas,$('touchpad')])el.addEventListener('contextmenu',e=>e.preventDefault());
for(const el of [canvas,$('touchpad')])el.addEventListener('keydown',e=>{if(e.code.startsWith('Arrow')){e.preventDefault();keys.add(e.code);}});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();release();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();release();}});
if('IntersectionObserver' in window)new IntersectionObserver(entries=>{inView=entries[0].isIntersecting;if(!inView){keys.clear();release();}}).observe(canvas.parentElement);
$('task').addEventListener('change',reset);$('reset').addEventListener('click',reset);
async function init(){try{tasks=await(await fetch('demo/tasks.json')).json();$('task').replaceChildren(...tasks.map((t,i)=>new Option(t.title,i)));task=tasks[0];state={block:task.start.slice(2),pusher:task.start.slice(0,2)};draw();worker=new Worker('demo/worker.js?v=try-it-v16');worker.onerror=()=>status('Unable to start physics. Please reload or try a current browser.');worker.onmessage=({data})=>{if(data.type==='ready'){ready=true;for(const id of ['task','reset'])$(id).disabled=false;reset();}else if(data.type==='error'){busy=false;failed=true;status(data.message);}else if(data.type==='state'&&data.generation===generation){busy=false;state=data.state;if(state.goal){resetting=false;task={...task,start:state.start,goal:state.goal};target=state.pusher.slice();$('world').dataset.resetSeed=String(state.seed);$('world').dataset.start=JSON.stringify(state.start);$('world').dataset.goal=JSON.stringify(state.goal);status('Push the object onto the green target.');}const score=state.overlap*100;$('score').textContent=score.toFixed(0)+'%';$('progress').value=score;if(score>=95&&!won){won=true;status('Goal reached! Choose another environment or reset to try again.');$('status').classList.add('success');}draw();}};}catch(e){status('Unable to load the demo. Please check your connection and reload.');}}
setInterval(()=>{if(!ready||busy||resetting||failed||won||document.hidden||!inView)return;const speed=5;target[0]+=speed*((keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0));target[1]+=speed*((keys.has('ArrowDown')?1:0)-(keys.has('ArrowUp')?1:0));target=target.map(v=>Math.max(task.bounds[0]+15,Math.min(task.bounds[1]-15,v)));busy=true;worker.postMessage({type:'step',target,steps:PHYSICS_STEPS,generation});},CONTROL_MS);
init();
