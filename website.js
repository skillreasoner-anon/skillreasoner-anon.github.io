/* Research-page interactions. The physics demo remains a separate lazy load. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const stageCopy = [
    'The state encoder encodes the latest observation–action history into a latent state. The goal supplies target object keypoints and encoded goal observations.',
    'Sample candidate skills from the proposal function P, conditioned on the current latent state.',
    'Beam search rolls skills forward with dynamics F. Each imagined trajectory is scored by goal evaluation at its endpoint, a risk proxy along its rollout, and a learned cost-to-go.',
    'The skill decoder translates the first selected skill into low-level actions. SkillReasoner then replans using new observations.'
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

  const learningCopy = [
    'State encoder E encodes a 3-step observation–action history into latent state z. State grounding G predicts goal features (keypoints); coordinatewise variance weights feature errors during training.',
    'Sample interaction windows of varying duration. Skill encoder Q compresses each window into discrete tokens u. Decoder D reconstructs its actions and predicts the duration, conditioned on state z.',
    'Freeze E, Q, D, and G, then learn the proposal, dynamics, and value on the resulting latent states and skills.',
    'Proposal P learns to sample Q-encoded skills from state z. Dynamics F predicts their encoded endpoints. Value V learns negative, duration-aware goal-reaching cost from hindsight goals.'
  ];
  let learningStage = 0, learningTimer = null;
  function setLearningStage(value) {
    learningStage = value;
    el('learning-diagram').dataset.learningStage = String(value);
    el('learning-copy').textContent = learningCopy[value];
    document.querySelectorAll('button[data-learning-stage]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.learningStage) === value)));
  }
  function stopLearning() {
    clearInterval(learningTimer); learningTimer = null;
    el('learning-play').textContent = 'Play explanation';
    el('learning-play').setAttribute('aria-pressed', 'false');
  }
  document.querySelectorAll('button[data-learning-stage]').forEach(button => button.addEventListener('click', () => {
    stopLearning(); setLearningStage(Number(button.dataset.learningStage));
  }));
  el('learning-play').addEventListener('click', () => {
    if (learningTimer) { stopLearning(); return; }
    el('learning-play').textContent = 'Pause explanation';
    el('learning-play').setAttribute('aria-pressed', 'true');
    learningTimer = setInterval(() => setLearningStage((learningStage + 1) % 4), 7000);
  });
  async function loadLearningDiagram() {
    try {
      const response = await fetch('learning.svg');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const doc = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
      if (doc.querySelector('parsererror')) throw new Error('Invalid learning diagram');
      el('learning-visual').replaceChildren(document.importNode(doc.documentElement, true));
      setLearningStage(0);
      document.querySelectorAll('button[data-learning-stage], #learning-play').forEach(button => button.disabled = false);
    } catch (error) {
      el('learning-visual').textContent = 'The learning illustration could not load. Please reload the page.';
    }
  }

  const descriptions = {
    narrow_door: ['Narrow Passage', 'Extended free-space motion with fine adjustments near the passage and final goal.'],
    multi_room: ['Multi-Room', 'Two possible object pathways to the same goal.'],
    three_door: ['Winding Maze', 'Long-horizon rollouts through successive passages.']
  };
  const blockShape = [[-60,0],[60,0],[60,30],[15,30],[15,120],[-15,120],[-15,30],[-60,30]];
  let recordings = null, recording = null, selected = 'multi_room', outcome = 'success', frame = 0, position = 0, playing = false, lastTimestamp = null;
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
  function selectRecording(key, nextOutcome = outcome) {
    if (!recordings) return;
    stopRollout(); selected = key; outcome = nextOutcome; recording = recordings[key][outcome]; frame = 0; position = 0;
    el('rollout-title').textContent = descriptions[key][0]; el('rollout-description').textContent = descriptions[key][1];
    el('rollout-depth').textContent = `${recording.depth} skills`;
    el('rollout-identity').textContent = `${(recording.final_overlap*100).toFixed(1)}% final object–goal overlap`;
    el('rollout-scrub').max = String(recording.control_steps);
    el('rollout-outcome').textContent = recording.success ? 'Successful execution' : 'Failed execution';
    document.querySelectorAll('[data-outcome]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.outcome === outcome)));
    canvas.setAttribute('aria-label', `${descriptions[key][0]}: ${outcome}, recorded evaluation episode`);
    document.querySelectorAll('[data-rollout]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.rollout === key)));
    render();
  }
  function tick(timestamp) {
    if (!playing) return;
    if (lastTimestamp !== null) position += Math.min(timestamp-lastTimestamp,250)/1000*recording.control_hz;
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
  document.querySelectorAll('[data-outcome]').forEach(button => button.addEventListener('click', () => selectRecording(selected, button.dataset.outcome)));
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
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopLearning(); stopExplanation(); stopRollout(); } });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) return;
      if (entry.target.id === 'learning') stopLearning();
      if (entry.target.id === 'method') stopExplanation();
      if (entry.target.id === 'rollouts') stopRollout();
      if (entry.target.id === 'try-it' && demoLoaded && !el('pause').disabled && el('pause').textContent === 'Pause') el('pause').click();
    }), {threshold:0});
    ['learning','method','rollouts','try-it'].forEach(id => observer.observe(el(id)));
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
      scene(el('world').getContext('2d'),el('world'),recordings.narrow_door.success,recordings.narrow_door.success.states[0]);
    } catch (error) {
      el('rollout-error').hidden = false;
      el('rollout-error').textContent = 'Recorded playback could not load. Please reload the page. The physics demo remains available.';
    }
  }
  loadRecordings();
  loadLearningDiagram();
})();
