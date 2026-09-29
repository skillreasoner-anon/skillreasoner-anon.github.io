/* Research-page interactions. The physics demo remains a separate lazy load. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const stageCopy = [
    'Encode the latest observation–action history into a latent state. The goal specifies the desired object arrangement.',
    'Sample candidate latent skills from the state-conditioned proposal. Each skill represents a behavior with a learned temporal horizon.',
    'Roll candidate skills forward with learned latent dynamics. Beam search scores imagined sequences using goal geometry, rollout risk, and learned cost-to-go.',
    'Decode and execute the first selected skill as low-level actions. Encode the new observations and search again; the imagined remainder is not executed blindly.'
  ];
  let stage = 0, explanationTimer = null;
  function setStage(value) {
    stage = value;
    el('method-diagram').dataset.stage = String(stage);
    el('method-copy').textContent = stageCopy[stage];
    document.querySelectorAll('button[data-stage]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.stage) === stage)));
  }
  function stopExplanation() {
    clearInterval(explanationTimer); explanationTimer = null;
    el('method-play').textContent = 'Play explanation';
    el('method-play').setAttribute('aria-pressed', 'false');
  }
  document.querySelectorAll('button[data-stage]').forEach(button => button.addEventListener('click', () => { stopExplanation(); setStage(Number(button.dataset.stage)); }));
  el('method-play').addEventListener('click', () => {
    if (explanationTimer) { stopExplanation(); return; }
    el('method-play').textContent = 'Pause explanation';
    el('method-play').setAttribute('aria-pressed', 'true');
    explanationTimer = setInterval(() => setStage((stage + 1) % 4), 2600);
  });

  const descriptions = {
    narrow_door: ['Narrow Passage', 'Rotate and transport the block through a tight opening, then align with the target.'],
    multi_room: ['Multi-Room', 'Change contact and navigate between rooms before refining the final pose.'],
    three_door: ['Winding Maze', 'Compose a longer sequence of interactions through three alternating passages.']
  };
  const blockShape = [[-60,0],[60,0],[60,30],[15,30],[15,120],[-15,120],[-15,30],[-60,30]];
  let recordings = null, recording = null, selected = 'narrow_door', frame = 0, position = 0, playing = false, lastTimestamp = null;
  const canvas = el('rollout-world'), ctx = canvas.getContext('2d');
  const timeline = el('skill-timeline'), timelineCtx = timeline.getContext('2d');
  function polygon(context, pose, fill, stroke, dashed = false) {
    context.save(); context.translate(pose[0], pose[1]); context.rotate(pose[2]);
    context.beginPath(); blockShape.forEach(([x,y], index) => index ? context.lineTo(x,y) : context.moveTo(x,y)); context.closePath();
    context.fillStyle = fill; context.fill(); context.strokeStyle = stroke; context.lineWidth = 2; context.setLineDash(dashed ? [7,5] : []); context.stroke(); context.restore();
  }
  function scene(context, targetCanvas, data, state) {
    context.clearRect(0,0,targetCanvas.width,targetCanvas.height); context.save();
    context.scale(targetCanvas.width/data.world_size, targetCanvas.height/data.world_size);
    context.fillStyle = '#fff'; context.fillRect(0,0,data.world_size,data.world_size);
    polygon(context, data.goal, '#e0ebda', '#788e6c', true);
    context.fillStyle = '#89979d'; data.walls.forEach(wall => context.fillRect(wall.x-wall.width/2,wall.y-wall.height/2,wall.width,wall.height));
    polygon(context, state.slice(2), '#a9b7be', '#596f7b');
    context.beginPath(); context.arc(state[0],state[1],15,0,Math.PI*2); context.fillStyle = '#c5a06c'; context.fill(); context.strokeStyle = '#8e6c40'; context.lineWidth = 2; context.stroke();
    context.restore();
  }
  function render() {
    scene(ctx,canvas,recording,recording.states[frame]);
    const starts = recording.cycle_starts;
    const skillIndex = starts.findLastIndex(start => start <= frame);
    el('rollout-step').textContent = `${frame} / ${recording.control_steps}`;
    el('rollout-skill').textContent = frame === recording.control_steps ? 'Complete' : `${skillIndex+1} / ${starts.length}`;
    el('rollout-time').textContent = `${(frame/recording.control_hz).toFixed(1)} s`;
    el('rollout-scrub').value = String(frame);
    timelineCtx.clearRect(0,0,timeline.width,timeline.height);
    starts.forEach((start,index) => {
      const end = starts[index+1] ?? recording.control_steps;
      timelineCtx.fillStyle = index === skillIndex ? '#985c48' : (index%2 ? '#d6c39f' : '#bda374');
      timelineCtx.fillRect(start/recording.control_steps*timeline.width,8,Math.max(1,(end-start)/recording.control_steps*timeline.width-2),30);
    });
    const cursor = Math.min(timeline.width-2,frame/recording.control_steps*timeline.width);
    timelineCtx.fillStyle = '#292c2e'; timelineCtx.fillRect(cursor,0,3,timeline.height);
  }
  function stopRollout() {
    playing = false; lastTimestamp = null;
    el('rollout-play').textContent = 'Play rollout'; el('rollout-play').setAttribute('aria-pressed','false');
  }
  function selectRecording(key) {
    if (!recordings) return;
    stopRollout(); selected = key; recording = recordings[key]; frame = 0; position = 0;
    el('rollout-title').textContent = descriptions[key][0]; el('rollout-description').textContent = descriptions[key][1];
    el('rollout-depth').textContent = `${recording.depth} skills`;
    el('rollout-identity').textContent = `Episode ${recording.episode_id} · ${recording.cycle_starts.length} executed skills · ${(recording.final_overlap*100).toFixed(1)}% terminal overlap. Selected successful example.`;
    el('rollout-scrub').max = String(recording.control_steps);
    document.querySelectorAll('[data-rollout]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.rollout === key)));
    render();
  }
  function tick(timestamp) {
    if (!playing) return;
    if (lastTimestamp !== null) position += Math.min(timestamp-lastTimestamp,250)/1000*recording.control_hz*Number(el('rollout-speed').value);
    lastTimestamp = timestamp;
    const next = Math.min(recording.control_steps, Math.floor(position));
    if (next !== frame) { frame = next; render(); }
    if (frame === recording.control_steps) stopRollout();
    else requestAnimationFrame(tick);
  }
  el('rollout-play').addEventListener('click', () => {
    if (!recording) return;
    if (playing) { stopRollout(); return; }
    if (frame === recording.control_steps) { frame = 0; position = 0; render(); }
    playing = true; lastTimestamp = null;
    el('rollout-play').textContent = 'Pause rollout'; el('rollout-play').setAttribute('aria-pressed','true'); requestAnimationFrame(tick);
  });
  el('rollout-restart').addEventListener('click', () => selectRecording(selected));
  el('rollout-scrub').addEventListener('input', event => { if (!recording) return; stopRollout(); frame = Number(event.target.value); position = frame; render(); });
  document.querySelectorAll('[data-rollout]').forEach(button => button.addEventListener('click', () => selectRecording(button.dataset.rollout)));
  let demoLoaded = false;
  el('load-demo').addEventListener('click', () => {
    if (demoLoaded) return;
    demoLoaded = true; el('load-demo').disabled = true; el('load-demo').textContent = 'Simulation loading…';
    el('status').textContent = 'Loading local physics engine…';
    const script = document.createElement('script'); script.src = 'demo/app.js?v=v60-1';
    script.onerror = () => { demoLoaded = false; el('load-demo').disabled = false; el('load-demo').textContent = 'Retry loading simulation'; el('status').textContent = 'Unable to load simulation code. Please try again.'; };
    document.body.append(script);
  });
  const demoStateObserver = new MutationObserver(() => {
    if (!el('task').disabled) {
      el('load-demo').textContent = 'Simulation ready'; el('demo-load-note').textContent = 'Use the mouse, touchpad, or arrow keys to control the pusher.';
      demoStateObserver.disconnect();
    }
  });
  demoStateObserver.observe(el('task'), { attributes:true, attributeFilter:['disabled'] });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopExplanation(); stopRollout(); } });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) return;
      if (entry.target.id === 'method') stopExplanation();
      if (entry.target.id === 'rollouts') stopRollout();
      if (entry.target.id === 'try-it' && demoLoaded && !el('pause').disabled && el('pause').textContent === 'Pause') el('pause').click();
    }), {threshold:0});
    ['method','rollouts','try-it'].forEach(id => observer.observe(el(id)));
    const videos = new IntersectionObserver(entries => entries.forEach(entry => { if (!entry.isIntersecting) entry.target.pause(); }));
    document.querySelectorAll('video').forEach(video => videos.observe(video));
  }
  async function loadRecordings() {
    try {
      const response = await fetch('assets/rollouts.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      recordings = await response.json();
      selectRecording(selected);
      ['rollout-play','rollout-restart','rollout-scrub'].forEach(id => el(id).disabled = false);
      // Preview the interactive task without downloading its 27 MB runtime.
      scene(el('world').getContext('2d'),el('world'),recordings.narrow_door,recordings.narrow_door.states[0]);
    } catch (error) {
      el('rollout-error').hidden = false;
      el('rollout-error').textContent = 'Recorded playback could not load. Please reload the page. The figures and physics demo remain available.';
    }
  }
  loadRecordings();
})();
