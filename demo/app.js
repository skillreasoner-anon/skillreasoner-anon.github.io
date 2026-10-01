'use strict';
const $=id=>document.getElementById(id),canvas=$('world'),ctx=canvas.getContext('2d'),opponentCanvas=$('race-opponent');
let tasks=[],recordings={},task,recording,state,worker,ready=false,failed=false,inView=true,busy=false,resetting=false,generation=0,target=[0,0],won=false;
let racing=false,raceElapsed=0,humanFinish=null,opponentFinish=0,opponentFrame=0,opponentDone=false,opponentScores=[];
const keys=new Set();let held=false,lastTouch=null,inputPointer=null;
const CONTROL_MS=25,PHYSICS_STEPS=20,LIMIT=72;
const shape=[[-60,0],[60,0],[60,30],[15,30],[15,120],[-15,120],[-15,30],[-60,30]];
const parts=[shape.slice(0,4).map(p=>p.slice()),[[-15,30],[15,30],[15,120],[-15,120]]];
// Exact two-rectangle T geometry; used only to display overlap of saved poses.
parts[0]=[[-60,0],[60,0],[60,30],[-60,30]];
function polygons(pose){const c=Math.cos(pose[2]),s=Math.sin(pose[2]);return parts.map(part=>part.map(([x,y])=>[pose[0]+c*x-s*y,pose[1]+s*x+c*y]));}
function area(p){return Math.abs(p.reduce((a,v,i)=>{const w=p[(i+1)%p.length];return a+v[0]*w[1]-w[0]*v[1];},0))/2;}
function clip(poly,boundary){for(let i=0;i<boundary.length;i++){const a=boundary[i],b=boundary[(i+1)%boundary.length],old=poly;poly=[];if(!old.length)break;const side=p=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);let prev=old[old.length-1],sp=side(prev);for(const cur of old){const sc=side(cur);if((sc>=0)!==(sp>=0)){const t=sp/(sp-sc);poly.push([prev[0]+t*(cur[0]-prev[0]),prev[1]+t*(cur[1]-prev[1])]);}if(sc>=0)poly.push(cur);prev=cur;sp=sc;}}return poly;}
function overlap(pose){const goal=polygons(task.goal);return Math.min(1,Math.max(0,polygons(pose).reduce((sum,p)=>sum+goal.reduce((v,g)=>v+area(clip(p,g)),0),0)/6300));}
function polygon(context,pose,fill,stroke,dashed=false){context.save();context.translate(pose[0],pose[1]);context.rotate(pose[2]);context.beginPath();shape.forEach(([x,y],i)=>i?context.lineTo(x,y):context.moveTo(x,y));context.closePath();context.fillStyle=fill;context.fill();context.strokeStyle=stroke;context.lineWidth=2;context.setLineDash(dashed?[6,4]:[]);context.stroke();context.restore();}
function drawSide(context,node,pose,pusher,showTarget){context.clearRect(0,0,node.width,node.height);context.save();context.scale(node.width/task.size,node.height/task.size);context.fillStyle='#fff';context.fillRect(0,0,task.size,task.size);polygon(context,task.goal,'#dae5d4','#68775c',true);context.fillStyle='#79848a';for(const [x,y,w,h] of task.walls)context.fillRect(x-w/2,y-h/2,w,h);polygon(context,pose,'#a6b0b6','#596973');context.beginPath();context.arc(...pusher,15,0,Math.PI*2);context.fillStyle='#c5a47e';context.fill();context.strokeStyle='#a56a56';context.lineWidth=2;context.stroke();if(showTarget){context.beginPath();context.arc(...target,5,0,Math.PI*2);context.stroke();}context.restore();}
function draw(){if(!task||!state||!recording)return;drawSide(ctx,canvas,state.block,state.pusher,held);const row=recording.states[opponentFrame];drawSide(opponentCanvas.getContext('2d'),opponentCanvas,row.slice(2),row.slice(0,2),false);}
function status(text){$('status').textContent=text;}
function seconds(t){return `${t.toFixed(2)} s`;}
function release(e){if(e&&e.pointerId!==inputPointer)return;const id=inputPointer;inputPointer=null;held=false;lastTouch=null;for(const node of [canvas,$('touchpad')]){if(id!==null&&node.hasPointerCapture(id))node.releasePointerCapture(id);}$('touchpad').classList.remove('active');}
function available(){return ready&&(racing||raceElapsed===0)&&!resetting&&!failed&&!won;}
function reset(){
 if(!ready)return;
 generation++;racing=false;raceElapsed=0;humanFinish=null;opponentDone=false;won=false;failed=false;keys.clear();release();
 const template=tasks[+$('task').value];recording=recordings[template.id].success[+$('race-episode').value];
 task={...template,recorded_start:true,recording_id:recording.recording_id,start:recording.states[0].slice(),goal:recording.goal.slice(),size:recording.world_size,walls:recording.walls.map(w=>[w.x,w.y,w.width,w.height])};
 opponentScores=recording.states.map(row=>overlap(row.slice(2)));const finishFrame=opponentScores.findIndex(v=>v>=.95);
 if(finishFrame<=0){failed=true;status('This recording is unavailable. Choose another episode.');return;}
 opponentFinish=finishFrame/recording.control_hz;opponentFrame=0;state={pusher:task.start.slice(0,2),block:task.start.slice(2),overlap:opponentScores[0],elapsed:0};target=state.pusher.slice();
 $('race-result').hidden=true;$('status').classList.remove('success');$('human-finish').textContent='Ready';$('opponent-finish').textContent='Ready';
 busy=true;resetting=true;worker.postMessage({type:'reset',task,generation});status('Preparing the shared start and goal…');renderMetrics();draw();
}
function episodes(){const rows=recordings[tasks[+$('task').value].id].success;$('race-episode').replaceChildren(...rows.map((r,i)=>new Option(`${i+1} of ${rows.length}`,i)));reset();}
function renderMetrics(){
 $('race-time').textContent=seconds(raceElapsed);$('score').textContent=(state.overlap*100).toFixed(0)+'%';$('progress').value=state.overlap*100;
 $('opponent-score').textContent=(opponentScores[opponentFrame]*100).toFixed(0)+'%';$('opponent-progress').value=opponentScores[opponentFrame]*100;
 canvas.dataset.elapsed=String(raceElapsed);opponentCanvas.dataset.elapsed=String(raceElapsed);opponentCanvas.dataset.frame=String(opponentFrame);
}
function advanceRace(){
 opponentFrame=Math.min(Math.floor((Math.min(raceElapsed,opponentFinish)+1e-8)*recording.control_hz),recording.control_steps);
 if(!opponentDone&&raceElapsed+1e-8>=opponentFinish){opponentDone=true;$('opponent-finish').textContent=`Finished · ${seconds(opponentFinish)}`;if(!won)status(`SkillReasoner finished in ${seconds(opponentFinish)}. Keep going!`);}
 if(won&&opponentDone||raceElapsed+1e-8>=LIMIT){
  racing=false;keys.clear();release();
  let result;
  if(humanFinish===null){$('human-finish').textContent='Time limit';result=`SkillReasoner: ${seconds(opponentFinish)}. You: time limit reached.`;}
  else if(Math.abs(humanFinish-opponentFinish)<1e-8)result=`Tie! Both finished in ${seconds(humanFinish)}.`;
  else result=`${humanFinish<opponentFinish?'You win!':'SkillReasoner wins.'} You: ${seconds(humanFinish)} · SkillReasoner: ${seconds(opponentFinish)}.`;
  $('race-result').textContent=result;$('race-result').hidden=false;status('Race complete. Reset to try the same challenge again.');
 }
 renderMetrics();draw();
}
function startFromInput(){if(!available()||racing)return;racing=true;$('human-finish').textContent='Racing';$('opponent-finish').textContent='Racing';status('Go! Match at least 95% of the target.');}
function direct(e){const r=canvas.getBoundingClientRect();target=[(e.clientX-r.left)/r.width*task.size,(e.clientY-r.top)/r.height*task.size];if(Math.hypot(target[0]-state.pusher[0],target[1]-state.pusher[1])>.1)startFromInput();}
canvas.addEventListener('pointerdown',e=>{if(!available()||inputPointer!==null)return;e.preventDefault();inputPointer=e.pointerId;canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);held=true;direct(e);});
canvas.addEventListener('pointermove',e=>{if(held&&e.pointerId===inputPointer){e.preventDefault();direct(e);}});
for(const node of [canvas,$('touchpad')])for(const event of ['pointerup','pointercancel','lostpointercapture'])node.addEventListener(event,release);
$('touchpad').addEventListener('pointerdown',e=>{if(!available()||inputPointer!==null)return;e.preventDefault();inputPointer=e.pointerId;$('touchpad').focus({preventScroll:true});$('touchpad').setPointerCapture(e.pointerId);lastTouch=[e.clientX,e.clientY];target=state.pusher.slice();$('touchpad').classList.add('active');});
$('touchpad').addEventListener('pointermove',e=>{if(!lastTouch||e.pointerId!==inputPointer)return;e.preventDefault();const gain=task.size/canvas.getBoundingClientRect().width;target=[target[0]+(e.clientX-lastTouch[0])*gain,target[1]+(e.clientY-lastTouch[1])*gain].map(x=>Math.max(task.bounds[0]+15,Math.min(task.bounds[1]-15,x)));if(Math.hypot(e.clientX-lastTouch[0],e.clientY-lastTouch[1])>.1)startFromInput();lastTouch=[e.clientX,e.clientY];});
for(const node of [canvas,$('touchpad')]){node.addEventListener('contextmenu',e=>e.preventDefault());node.addEventListener('keydown',e=>{if(e.code.startsWith('Arrow')){e.preventDefault();if(available()){keys.add(e.code);startFromInput();}}});}
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();release();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();release();}});
new IntersectionObserver(entries=>{inView=entries[0].isIntersecting;if(!inView){keys.clear();release();}}).observe($('try-it'));
$('task').addEventListener('change',episodes);$('race-episode').addEventListener('change',reset);$('reset').addEventListener('click',reset);
async function init(){try{
 [tasks,recordings]=await Promise.all(['demo/tasks.json','assets/rollouts.json'].map(async path=>{const r=await fetch(path);if(!r.ok)throw Error('Unavailable');return r.json();}));
 $('task').replaceChildren(...tasks.map((t,i)=>new Option(t.title,i)));
 worker=new Worker('demo/worker.js?v=race-v27');
 worker.onerror=()=>{failed=true;racing=false;busy=false;status('Unable to start physics. Please reload or try a current browser.');};
 worker.onmessage=({data})=>{
  if(data.type==='ready'){ready=true;for(const id of ['task','race-episode','reset'])$(id).disabled=false;episodes();}
  else if(data.type==='error'&&(data.generation===undefined||data.generation===generation)){busy=false;failed=true;racing=false;status(data.message);}
  else if(data.type==='state'&&data.generation===generation){
   busy=false;state=data.state;
   if(resetting&&state.goal){resetting=false;target=state.pusher.slice();canvas.dataset.start=JSON.stringify(state.start);canvas.dataset.goal=JSON.stringify(state.goal);canvas.dataset.recordingId=state.recording_id;opponentCanvas.dataset.start=canvas.dataset.start;opponentCanvas.dataset.goal=canvas.dataset.goal;status('Move your pusher to start both sides together.');renderMetrics();draw();return;}
   raceElapsed=state.elapsed;
   if(state.overlap>=.95&&!won){won=true;humanFinish=raceElapsed;keys.clear();release();$('human-finish').textContent=`Finished · ${seconds(humanFinish)}`;status('You reached the goal! Waiting for SkillReasoner to finish.');}
   advanceRace();
  }
 };
}catch(e){failed=true;status('Unable to load the race. Please reload and try again.');}}
setInterval(()=>{
 if(!ready||!racing||busy||resetting||failed||document.hidden||!inView)return;
 if(won){raceElapsed=Math.min(LIMIT,raceElapsed+CONTROL_MS/1000);advanceRace();return;}
 const speed=5;target[0]+=speed*((keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0));target[1]+=speed*((keys.has('ArrowDown')?1:0)-(keys.has('ArrowUp')?1:0));target=target.map(v=>Math.max(task.bounds[0]+15,Math.min(task.bounds[1]-15,v)));
 busy=true;worker.postMessage({type:'step',target,steps:PHYSICS_STEPS,generation});
},CONTROL_MS);
init();
