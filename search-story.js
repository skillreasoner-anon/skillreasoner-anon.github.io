/* A staged reveal of saved beam candidates; never a synthetic planner rollout. */
(() => {
  'use strict';
  const section = document.getElementById('search-story');
  const canvas = document.getElementById('search-canvas'), ctx = canvas.getContext('2d');
  const play = document.getElementById('search-play'), replay = document.getElementById('search-replay');
  const slider = document.getElementById('search-seek'), caption = document.getElementById('search-caption');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const names = ['Explore possible futures', 'Bring a route into focus', 'Execute the first skill', 'Observe. Search again.'];
  const copies = ['The learned model predicts where different skill sequences could take the object.', 'Compare goal progress, predicted risk, and cost-to-go. Keep the selected sequence.', 'Decode just the first skill into actions. The rest remains a prediction.', 'Use the new observation as the starting point for another search.'];
  let data, time = 0, last = null, playing = false, visible = false, raf = null, lastKey = '';
  const seconds = 9, phases = [0, 3.2, 5.2, 7.7];
  const shape = [[-60,0],[60,0],[60,30],[15,30],[15,120],[-15,120],[-15,30],[-60,30]];
  function pose(p, fill, stroke, alpha = 1) {
    ctx.save();ctx.globalAlpha=alpha;ctx.translate(p[0],p[1]);ctx.rotate(p[2]);ctx.beginPath();
    shape.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();
    ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=1.7;ctx.stroke();ctx.restore();
  }
  function path(points, color, alpha, width, progress=1) {
    ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
    const n=(points.length-1)*Math.max(0,Math.min(1,progress)),whole=Math.floor(n);
    points.slice(0,whole+1).forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
    if(whole<points.length-1){const a=points[whole],b=points[whole+1];ctx.lineTo(a[0]+(b[0]-a[0])*(n-whole),a[1]+(b[1]-a[1])*(n-whole));}
    ctx.stroke();ctx.restore();
  }
  function draw() {
    if(!data)return;
    const index=Math.min(data.cycles.length-1,Math.floor(time/seconds)),t=time-index*seconds;
    const cycle=data.cycles[index],phase=t<3.2?0:t<5.2?1:t<7.7?2:3;
    section.dataset.phase=String(phase);section.dataset.cycle=String(index);
    const chosen=cycle.candidates.find(c=>c.selected),origin=cycle.states[0].slice(2);
    const amount=Math.max(0,Math.min(1,(t-5.2)/2.5));
    const state=cycle.states[Math.min(cycle.states.length-1,Math.floor(amount*(cycle.states.length-1)))];
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#f1ede4';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.save();const scale=(canvas.width-48)/data.world_size;ctx.translate(24,24);ctx.scale(scale,scale);
    ctx.fillStyle='#b9b9af';data.walls.forEach(w=>ctx.fillRect(w.x-w.width/2,w.y-w.height/2,w.width,w.height));
    ctx.save();ctx.setLineDash([6,5]);pose(data.goal,'#dfe5d8','#829276');ctx.restore();
    // Show retained alternatives first, then fade them as the selected route emerges.
    cycle.candidates.filter(c=>!c.selected).forEach((c,i)=>{
      const alpha=phase===0?.48:phase===1?.48*(1-(t-3.2)/2)*.8+.07:.06;
      path([origin,...c.points],i%2?'#b78d59':'#829b9a',alpha,2.5,(t-i*.16)/2.4);
      if(phase<2)c.points.forEach((p,j)=>{if(j/c.points.length<t/3.2){ctx.beginPath();ctx.arc(p[0],p[1],3,0,Math.PI*2);ctx.fillStyle=`rgba(157,135,105,${alpha})`;ctx.fill();}});
    });
    const chosenAlpha=phase===0?.35:phase===1?1:phase===2?.45:.15;
    const route=[origin,...chosen.points];
    path(route,phase===0?'#829b9a':'#b86f56',chosenAlpha,3.5,t/3.2);
    if(phase===1){
      path(route,'#cd8068',.12,13);
      chosen.points.forEach((p,j)=>{ctx.beginPath();ctx.arc(p[0],p[1],3.8,0,Math.PI*2);ctx.fillStyle='#b86f56';ctx.fill();if(j%5===0||j===chosen.points.length-1)pose(p,'#cd8068','#a56a56',.13);});
    }
    if(phase>=2)path(cycle.states.slice(0,Math.max(1,Math.floor(amount*(cycle.states.length-1))+1)).map(s=>s.slice(2)),'#596f72',.85,3);
    if(phase===2)pose(chosen.points[0],'#cd8068','#a56a56',.2);
    pose(state.slice(2),'#758e92','#4c6469');
    ctx.beginPath();ctx.arc(state[0],state[1],15,0,Math.PI*2);ctx.fillStyle='#c5a06c';ctx.fill();ctx.strokeStyle='#98794f';ctx.lineWidth=2;ctx.stroke();
    if(phase===3){ctx.beginPath();ctx.arc(state[2],state[3],25+(t-7.7)*36,0,Math.PI*2);ctx.strokeStyle=`rgba(117,142,146,${Math.max(0,.6-(t-7.7)*.4)})`;ctx.lineWidth=2;ctx.stroke();}
    ctx.restore();
    slider.value=String(time);document.getElementById('search-cycle').textContent=`Replan ${index+1} / ${data.cycles.length}`;
    const key=`${index}/${phase}`;
    if(key!==lastKey){
      lastKey=key;caption.textContent=copies[phase];document.getElementById('search-phase-title').textContent=names[phase];
      document.querySelectorAll('#search-steps li').forEach((li,i)=>{li.classList.toggle('active',i===phase);if(i===phase)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});
      const strip=document.getElementById('search-skills');strip.replaceChildren(...chosen.durations.slice(0,7).map((d,i)=>{const span=document.createElement('span');span.textContent=`${(d/data.control_hz).toFixed(1)}s`;if(i===0)span.className='first';return span;}));
      document.getElementById('search-tail').textContent=chosen.durations.length>7?`+ ${chosen.durations.length-7} imagined skills`:'';
    }
  }
  function sync() {
    if(raf!==null)cancelAnimationFrame(raf);raf=null;last=null;
    play.textContent=playing?'Pause':'Play';play.setAttribute('aria-pressed',String(playing));
    if(playing&&visible&&!document.hidden)raf=requestAnimationFrame(tick);
  }
  function tick(now) {
    raf=null;if(last!==null)time=Math.min(seconds*data.cycles.length,time+Math.min(.1,(now-last)/1000));last=now;draw();
    if(time>=seconds*data.cycles.length){playing=false;sync();return;}
    if(playing&&visible&&!document.hidden)raf=requestAnimationFrame(tick);
  }
  play.addEventListener('click',()=>{if(time>=seconds*data.cycles.length)time=0;playing=!playing;sync();draw();});
  replay.addEventListener('click',()=>{time=0;playing=!motion.matches;sync();draw();});
  slider.addEventListener('input',()=>{time=Number(slider.value);playing=false;sync();draw();});
  document.addEventListener('visibilitychange',sync);
  motion.addEventListener('change',()=>{if(motion.matches){playing=false;sync();}});
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();},{threshold:.12}).observe(section);
  fetch('assets/search-story.json').then(r=>{if(!r.ok)throw Error('Search unavailable');return r.json();}).then(d=>{
    data=d;slider.max=String(seconds*data.cycles.length);[play,replay,slider].forEach(e=>e.disabled=false);time=motion.matches?4:0;playing=!motion.matches;draw();sync();
  }).catch(()=>{caption.textContent='The search illustration could not load. Please reload the page.';});
})();
