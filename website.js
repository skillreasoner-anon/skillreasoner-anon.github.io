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
    'Sample interaction windows of varying duration. Skill encoder Q compresses each window into discrete skill tokens u. Skill decoder D reconstructs its actions and predicts the duration, conditioned on state z.',
    'Freeze E, Q, D, and G, then learn the proposal, dynamics, and value on the resulting latent states and skills.'
  ];
  const windowDurations = [2, 5, 7];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let learningStage = 0, learningTimer = null, windowTimer = null, windowExample = 0;
  function setWindowExample(index) {
    windowExample = index;
    const duration = windowDurations[index];
    el('sampled-window').setAttribute('width', String(34 * duration));
    el('window-bracket').setAttribute('d', `M23 169V177H${23 + 34 * duration}V169`);
    el('sampled-duration').textContent = `Sampled window · d = ${duration}`;
    el('window-example').textContent = `Window duration: d = ${duration}`;
    document.querySelectorAll('.play-window-frames rect').forEach((rect, i) => { rect.dataset.sampled = String(i < duration); });
  }
  function syncWindowAnimation() {
    clearInterval(windowTimer); windowTimer = null;
    if (learningStage === 1 && learningTimer && !reducedMotion.matches) {
      windowTimer = setInterval(() => setWindowExample((windowExample + 1) % windowDurations.length), 2000);
    }
  }
  reducedMotion.addEventListener('change', syncWindowAnimation);
  function setLearningStage(value) {
    learningStage = value;
    el('learning-diagram').dataset.learningStage = String(value);
    el('learning-layout').dataset.learningStage = String(value);
    el('window-explanation').hidden = value !== 1;
    el('learning-copy').parentElement.hidden = value === 1;
    if (value === 1) setWindowExample(0);
    syncWindowAnimation();
    el('learning-copy').textContent = learningCopy[value];
    document.querySelectorAll('button[data-learning-stage]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.learningStage) === value)));
  }
  function stopLearning() {
    clearInterval(learningTimer); learningTimer = null;
    clearInterval(windowTimer); windowTimer = null;
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
    learningTimer = setInterval(() => setLearningStage((learningStage + 1) % learningCopy.length), 7000);
    syncWindowAnimation();
  });
  el('next-window').addEventListener('click', () => {
    stopLearning(); setWindowExample((windowExample + 1) % windowDurations.length);
  });
  async function loadLearningDiagram() {
    try {
      const response = await fetch('learning.svg');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const doc = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
      if (doc.querySelector('parsererror')) throw new Error('Invalid learning diagram');
      el('learning-visual').replaceChildren(document.importNode(doc.documentElement, true));
      setLearningStage(0);
      document.querySelectorAll('button[data-learning-stage], #learning-play, #next-window').forEach(button => button.disabled = false);
    } catch (error) {
      el('learning-visual').textContent = 'The learning diagram could not load. Please reload the page.';
    }
  }

  const descriptions = {
    narrow_door: ['Narrow Passage', 'Extended free-space motion with fine adjustments near the passage and final goal.'],
    multi_room: ['Multi-Room', 'Two possible object pathways to the same goal.'],
    three_door: ['Winding Maze', 'Long-horizon rollouts through successive passages.']
  };
  const blockShape = [[-60,0],[60,0],[60,30],[15,30],[15,120],[-15,120],[-15,30],[-60,30]];
  // Same duration spectrum as the paper's annotated skill timelines: 1–20 actions.
  const durationPalette = ['#CD8068', '#C5A47E', '#79848A'];
  function durationColor(duration) {
    const t = Math.max(0, Math.min(1, (duration-1)/19)) * 2;
    const index = Math.min(1, Math.floor(t)), fraction = t-index;
    const rgb = color => [1,3,5].map(i => parseInt(color.slice(i,i+2),16));
    const a = rgb(durationPalette[index]), b = rgb(durationPalette[index+1]);
    return `rgb(${a.map((v,i) => Math.round(v+(b[i]-v)*fraction)).join(', ')})`;
  }
  let recordings = null, recording = null, selected = 'multi_room', outcome = 'success', episodeIndex = 0;
  let frame = 0, position = 0, playing = false, lastTimestamp = null, rolloutRAF = null;
  const episodeMemory = new Map();
  const canvas = el('rollout-world'), ctx = canvas.getContext('2d');
  const timeline = el('skill-timeline');
  function polygon(context, pose, fill, stroke, dashed = false) {
    context.save(); context.translate(pose[0], pose[1]); context.rotate(pose[2]);
    context.beginPath(); blockShape.forEach(([x,y], index) => index ? context.lineTo(x,y) : context.moveTo(x,y)); context.closePath();
    context.fillStyle = fill; context.fill(); context.strokeStyle = stroke; context.lineWidth = 2; context.setLineDash(dashed ? [7,5] : []); context.stroke(); context.restore();
  }
  function scene(context, targetCanvas, data, state, drawPath = null) {
    context.clearRect(0,0,targetCanvas.width,targetCanvas.height); context.save();
    context.scale(targetCanvas.width/data.world_size, targetCanvas.height/data.world_size);
    context.fillStyle = '#fff'; context.fillRect(0,0,data.world_size,data.world_size);
    polygon(context, data.goal, '#e0ebda', '#788e6c', true);
    if (drawPath) drawPath(context);
    context.fillStyle = '#89979d'; data.walls.forEach(wall => context.fillRect(wall.x-wall.width/2,wall.y-wall.height/2,wall.width,wall.height));
    polygon(context, state.slice(2), '#a9b7be', '#596f7b');
    context.beginPath(); context.arc(state[0],state[1],15,0,Math.PI*2); context.fillStyle = '#c5a06c'; context.fill(); context.strokeStyle = '#8e6c40'; context.lineWidth = 2; context.stroke();
    context.restore();
  }
  function activeSkill() { return recording.cycle_starts.findLastIndex(start => start <= frame); }
  function drawRecordedPath(context) {
    if (!el('show-path').checked) return;
    const active = activeSkill();
    context.save(); context.lineCap = 'round'; context.lineJoin = 'round';
    const order = recording.cycle_starts.map((_,index) => index).filter(index => index !== active);
    order.push(active); // Draw the selected recorded skill above overlapping paths.
    order.forEach(index => {
      const start = recording.cycle_starts[index];
      const end = recording.cycle_starts[index+1] ?? recording.control_steps;
      context.globalAlpha = index === active ? 1 : (end <= frame ? .5 : .2);
      context.strokeStyle = durationColor(recording.skill_durations[index]);
      context.lineWidth = index === active ? 4 : 2;
      context.beginPath();
      for (let i=start; i<=end; i++) {
        const state = recording.states[i];
        if (i === start) context.moveTo(state[0],state[1]); else context.lineTo(state[0],state[1]);
      }
      context.stroke();
      if (index === active) {
        const state = recording.states[end];
        context.beginPath(); context.arc(state[0],state[1],4,0,Math.PI*2);
        context.fillStyle = context.strokeStyle; context.fill();
        context.strokeStyle = '#fff'; context.lineWidth = 1; context.stroke();
      }
    });
    context.restore();
  }
  function seekSkill(index) {
    if (!recording || index < 0 || index >= recording.cycle_starts.length) return;
    stopRollout(); frame = recording.cycle_starts[index]; position = frame; render();
  }
  function buildTimeline() {
    timeline.replaceChildren();
    recording.cycle_starts.forEach((start,index) => {
      const end = recording.cycle_starts[index+1] ?? recording.control_steps;
      const duration = recording.skill_durations[index];
      const button = document.createElement('button');
      button.type = 'button'; button.style.flexGrow = String(end-start);
      button.style.setProperty('--skill-color', durationColor(duration));
      button.dataset.skill = String(index); button.dataset.start = String(start);
      button.dataset.end = String(end); button.dataset.duration = String(duration);
      button.textContent = (end-start)/recording.control_steps >= .035 ? String(duration) : '';
      button.title = `Skill ${index+1}: ${duration} actions (${(duration/recording.control_hz).toFixed(1)} s)`;
      if (end-start < duration) button.title += `; ${end-start} actions executed`;
      button.setAttribute('aria-label', button.title);
      button.addEventListener('click', () => seekSkill(index));
      button.addEventListener('keydown', event => {
        const target = {ArrowLeft:index-1, ArrowRight:index+1, Home:0, End:recording.cycle_starts.length-1}[event.key];
        if (target === undefined) return;
        event.preventDefault();
        if (target < 0 || target >= recording.cycle_starts.length) return;
        seekSkill(target); timeline.children[target].focus();
      });
      timeline.append(button);
    });
  }
  function render() {
    scene(ctx,canvas,recording,recording.states[frame],drawRecordedPath);
    const starts = recording.cycle_starts, skillIndex = activeSkill();
    const start = starts[skillIndex], end = starts[skillIndex+1] ?? recording.control_steps;
    const duration = recording.skill_durations[skillIndex];
    el('rollout-step').textContent = `${frame} / ${recording.control_steps}`;
    el('rollout-skill').textContent = `${skillIndex+1} / ${starts.length}`;
    el('skill-duration').textContent = `${duration} actions · ${(duration/recording.control_hz).toFixed(1)} s`;
    el('skill-progress').textContent = `Recorded execution: ${frame-start} / ${end-start} actions`;
    el('skill-swatch').style.backgroundColor = durationColor(duration);
    el('skill-prev').disabled = skillIndex === 0;
    el('skill-next').disabled = skillIndex === starts.length-1;
    el('rollout-time').textContent = `${(frame/recording.control_hz).toFixed(1)} s`;
    el('rollout-scrub').value = String(frame);
    Array.from(timeline.children).forEach((button,index) => {
      button.setAttribute('aria-pressed', String(index === skillIndex));
      button.tabIndex = index === skillIndex ? 0 : -1;
    });
    el('timeline-cursor').style.left = `${frame/recording.control_steps*100}%`;
  }
  function stopRollout() {
    playing = false; lastTimestamp = null;
    cancelAnimationFrame(rolloutRAF); rolloutRAF = null;
    el('rollout-play').textContent = 'Play rollout'; el('rollout-play').setAttribute('aria-pressed','false');
  }
  function selectRecording(key, nextOutcome = outcome, nextEpisode = episodeMemory.get(`${key}/${nextOutcome}`) ?? 0) {
    if (!recordings) return;
    stopRollout(); selected = key; outcome = nextOutcome; episodeIndex = nextEpisode;
    const episodes = recordings[key][outcome];
    recording = episodes[episodeIndex]; episodeMemory.set(`${key}/${outcome}`, episodeIndex);
    frame = 0; position = 0;
    const options = episodes.map((row,index) => {
      const option = document.createElement('option'); option.value = String(index);
      option.textContent = `${index+1} of ${episodes.length} · ${(row.control_steps/row.control_hz).toFixed(1)} s`;
      return option;
    });
    el('rollout-episode').replaceChildren(...options); el('rollout-episode').value = String(episodeIndex);
    el('episode-prev').disabled = episodeIndex === 0;
    el('episode-next').disabled = episodeIndex === episodes.length-1;
    el('rollout-title').textContent = descriptions[key][0]; el('rollout-description').textContent = descriptions[key][1];
    el('rollout-depth').textContent = `${recording.depth} skills`;
    el('rollout-identity').textContent = `${(recording.final_overlap*100).toFixed(1)}% final object–goal overlap`;
    el('rollout-scrub').max = String(recording.control_steps);
    el('episode-duration').textContent = `${(recording.control_steps/recording.control_hz).toFixed(1)} s`;
    el('rollout-outcome').textContent = recording.success ? 'Successful execution' : 'Failed execution';
    document.querySelectorAll('[data-outcome]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.outcome === outcome)));
    canvas.setAttribute('aria-label', `${descriptions[key][0]}: ${outcome}, episode ${episodeIndex+1} of ${episodes.length}`);
    canvas.dataset.recordingId = recording.recording_id;
    document.querySelectorAll('[data-rollout]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.rollout === key)));
    buildTimeline(); render();
  }
  function tick(timestamp) {
    rolloutRAF = null;
    if (!playing) return;
    if (lastTimestamp !== null) position += Math.min(timestamp-lastTimestamp,250)/1000*recording.control_hz;
    lastTimestamp = timestamp;
    const next = Math.min(recording.control_steps, Math.floor(position));
    if (next !== frame) { frame = next; render(); }
    if (frame === recording.control_steps) stopRollout();
    else rolloutRAF = requestAnimationFrame(tick);
  }
  el('rollout-play').addEventListener('click', () => {
    if (!recording) return;
    if (playing) { stopRollout(); return; }
    if (frame === recording.control_steps) { frame = 0; position = 0; render(); }
    playing = true; lastTimestamp = null;
    el('rollout-play').textContent = 'Pause rollout'; el('rollout-play').setAttribute('aria-pressed','true'); rolloutRAF = requestAnimationFrame(tick);
  });
  el('rollout-restart').addEventListener('click', () => selectRecording(selected,outcome,episodeIndex));
  el('rollout-scrub').addEventListener('input', event => { if (!recording) return; stopRollout(); frame = Number(event.target.value); position = frame; render(); });
  document.querySelectorAll('[data-rollout]').forEach(button => button.addEventListener('click', () => selectRecording(button.dataset.rollout)));
  document.querySelectorAll('[data-outcome]').forEach(button => button.addEventListener('click', () => selectRecording(selected, button.dataset.outcome)));
  el('rollout-episode').addEventListener('change', event => selectRecording(selected,outcome,Number(event.target.value)));
  el('episode-prev').addEventListener('click', () => selectRecording(selected,outcome,episodeIndex-1));
  el('episode-next').addEventListener('click', () => selectRecording(selected,outcome,episodeIndex+1));
  el('skill-prev').addEventListener('click', () => seekSkill(activeSkill()-1));
  el('skill-next').addEventListener('click', () => seekSkill(activeSkill()+1));
  el('show-path').addEventListener('change', () => { if (recording) render(); });
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
      ['rollout-play','rollout-restart','rollout-scrub','rollout-episode'].forEach(id => el(id).disabled = false);
      // Preview the interactive task without downloading its 27 MB runtime.
      scene(el('world').getContext('2d'),el('world'),recordings.narrow_door.success[0],recordings.narrow_door.success[0].states[0]);
    } catch (error) {
      el('rollout-error').hidden = false;
      el('rollout-error').textContent = 'Recorded playback could not load. Please reload the page. The physics demo remains available.';
    }
  }
  loadRecordings();
  loadLearningDiagram();
})();
