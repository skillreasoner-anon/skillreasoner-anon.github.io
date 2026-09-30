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
    el('method-play').textContent = 'Play Explanation';
    el('method-play').setAttribute('aria-pressed', 'false');
  }
  document.querySelectorAll('button[data-stage]').forEach(button => button.addEventListener('click', () => { stopExplanation(); setStage(Number(button.dataset.stage)); }));
  el('method-play').addEventListener('click', () => {
    if (explanationTimer) { stopExplanation(); return; }
    el('method-play').textContent = 'Pause Explanation';
    el('method-play').setAttribute('aria-pressed', 'true');
    explanationTimer = setInterval(() => setStage((stage + 1) % 4), 2600);
  });

  const learningCopy = [
    'State encoder E encodes a 3-step observation–action history into latent state z. State grounding G predicts goal features (keypoints); coordinatewise variance weights feature errors during training.',
    'Sample interaction windows of varying duration. Skill encoder Q compresses each window into discrete skill tokens u. Skill decoder D reconstructs its actions and predicts the duration, conditioned on state z.',
    'Freeze E, Q, D, and G, then learn the proposal, dynamics, and value on the resulting latent states and skills.'
  ];
  // Selected durations use the same 1–20 scale as the paper's skill timelines.
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let learningStage = 0, learningTimer = null, windowTimer = null, windowPlaying = false;
  function setWindowExample(start, duration) {
    const left = 23 + 30*start, width = 30*duration, color = durationColor(duration);
    el('learning-layout').style.setProperty('--window-color', color);
    el('sampled-window').setAttribute('x', String(left));
    el('sampled-window').setAttribute('width', String(width));
    el('sampled-window').dataset.start = String(start);
    el('sampled-window').dataset.duration = String(duration);
    el('window-bracket').setAttribute('d', `M${left} 169V177H${left+width}V169`);
    el('window-flow').setAttribute('d', `M${left+width/2} 177V190H353V196`);
    el('sampled-duration').textContent = `Sampled Window · d = ${duration}`;
    el('window-example').textContent = `Window Duration: d = ${duration}`;
    el('window-position').textContent = `Steps ${start+1}–${start+duration}`;
    if (!reducedMotion.matches) el('sampled-window').animate([{opacity:.35},{opacity:1}], {duration:350, easing:'ease-out'});
    document.querySelectorAll('.play-window-frames rect').forEach((rect, i) => {
      rect.dataset.sampled = String(i >= start && i < start+duration);
    });
  }
  function sampleWindow() {
    const duration = 1 + Math.floor(Math.random()*20);
    const start = Math.floor(Math.random()*(21-duration));
    setWindowExample(start, duration);
  }
  function syncWindowAnimation() {
    clearInterval(windowTimer); windowTimer = null;
    el('window-play').disabled = reducedMotion.matches;
    const active = learningStage === 1 && windowPlaying && !reducedMotion.matches;
    el('window-play').textContent = active ? 'Pause Windows' : 'Play Windows';
    el('window-play').setAttribute('aria-pressed', String(active));
    if (active) windowTimer = setInterval(sampleWindow, 2000);
  }
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) windowPlaying = false;
    syncWindowAnimation();
  });
  function setLearningStage(value) {
    learningStage = value;
    el('learning-diagram').dataset.learningStage = String(value);
    el('learning-layout').dataset.learningStage = String(value);
    el('window-explanation').hidden = value !== 1;
    el('learning-copy').parentElement.hidden = value === 1;
    windowPlaying = value === 1 && !reducedMotion.matches;
    if (value === 1) setWindowExample(2, 2);
    syncWindowAnimation();
    el('learning-copy').textContent = learningCopy[value];
    document.querySelectorAll('button[data-learning-stage]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.learningStage) === value)));
  }
  function stopLearning() {
    clearInterval(learningTimer); learningTimer = null;
    windowPlaying = false; syncWindowAnimation();
    el('learning-play').textContent = 'Play Explanation';
    el('learning-play').setAttribute('aria-pressed', 'false');
  }
  document.querySelectorAll('button[data-learning-stage]').forEach(button => button.addEventListener('click', () => {
    stopLearning(); setLearningStage(Number(button.dataset.learningStage));
  }));
  el('learning-play').addEventListener('click', () => {
    if (learningTimer) { stopLearning(); return; }
    el('learning-play').textContent = 'Pause Explanation';
    el('learning-play').setAttribute('aria-pressed', 'true');
    learningTimer = setInterval(() => setLearningStage((learningStage + 1) % learningCopy.length), 7000);
    if (learningStage === 1) windowPlaying = true;
    syncWindowAnimation();
  });
  el('window-play').addEventListener('click', () => {
    windowPlaying = !windowPlaying; syncWindowAnimation();
  });
  el('next-window').addEventListener('click', () => {
    stopLearning(); sampleWindow();
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

  const environmentNames = {narrow_door:'Narrow Passage', multi_room:'Multi-Room', three_door:'Winding Maze'};
  const blockShape = [[-60,0],[60,0],[60,30],[15,30],[15,120],[-15,120],[-15,30],[-60,30]];
  const durationPalette = ['#CD8068', '#C5A47E', '#79848A'];
  function durationColor(duration) {
    const t = Math.max(0, Math.min(1, (duration-1)/19)) * 2;
    const index = Math.min(1, Math.floor(t)), fraction = t-index;
    const rgb = color => [1,3,5].map(i => parseInt(color.slice(i,i+2),16));
    const a = rgb(durationPalette[index]), b = rgb(durationPalette[index+1]);
    return `rgb(${a.map((v,i) => Math.round(v+(b[i]-v)*fraction)).join(', ')})`;
  }
  let recordings = null, baselineRecordings = null, results = null, recording = null;
  let selected = 'narrow_door', outcome = 'success', episodeIndex = 0, method = 'ours', compute = 'high';
  let frame = 0, position = 0, playing = false, lastTimestamp = null, rolloutRAF = null;
  const episodeMemory = new Map();
  const canvas = el('rollout-world'), ctx = canvas.getContext('2d');
  const timeline = el('skill-timeline');
  function polygon(context, pose, fill, stroke, dashed = false) {
    context.save(); context.translate(pose[0], pose[1]); context.rotate(pose[2]);
    context.beginPath(); blockShape.forEach(([x,y], index) => index ? context.lineTo(x,y) : context.moveTo(x,y)); context.closePath();
    context.fillStyle = fill; context.fill(); context.strokeStyle = stroke; context.lineWidth = 2;
    context.setLineDash(dashed ? [7,5] : []); context.stroke(); context.restore();
  }
  function scene(context, targetCanvas, data, state, drawPath = null) {
    context.clearRect(0,0,targetCanvas.width,targetCanvas.height); context.save();
    context.scale(targetCanvas.width/data.world_size, targetCanvas.height/data.world_size);
    context.fillStyle = '#fff'; context.fillRect(0,0,data.world_size,data.world_size);
    polygon(context, data.goal, '#e0ebda', '#788e6c', true);
    if (drawPath) drawPath(context);
    context.fillStyle = '#89979d'; data.walls.forEach(wall => context.fillRect(wall.x-wall.width/2,wall.y-wall.height/2,wall.width,wall.height));
    polygon(context, state.slice(2), '#a9b7be', '#596f7b');
    {
      context.beginPath(); context.arc(state[0],state[1],data.agent_radius ?? 15,0,Math.PI*2); context.fillStyle = '#c5a06c'; context.fill();
      context.strokeStyle = '#8e6c40'; context.lineWidth = 2; context.stroke();
    }
    context.restore();
  }
  function methodLabel(id) {
    if (id === 'ours') return 'SkillReasoner (Ours)';
    const item = results.methods.find(row => row.id === id);
    return `${item.label} · ${item.group === 'expert' ? 'Privileged Expert Demos' : 'Play Data'}`;
  }
  function episodeGroups() {
    return method === 'ours' ? recordings?.[selected] : baselineRecordings?.[method]?.[selected];
  }
  function memoryKey() { return `${selected}/${method}/${outcome}`; }
  function activeSkill() { return recording?.cycle_starts?.findLastIndex(start => start <= frame) ?? -1; }
  function drawRecordedPath(context) {
    if (method !== 'ours' || !recording.cycle_starts?.length || frame >= recording.control_steps) return;
    const active = activeSkill();
    if (active < 0) return;
    context.save(); context.lineCap = 'round'; context.lineJoin = 'round';
    // Saved execution paths: the remaining current skill and the next three.
    // Draw the current skill last so its color stays clear at intersections.
    const endIndex = Math.min(active + 4, recording.cycle_starts.length);
    const order = Array.from({length:endIndex-active-1}, (_,i) => active+i+1);
    order.push(active);
    order.forEach(index => {
      const start = Math.max(frame, recording.cycle_starts[index]);
      const end = recording.cycle_starts[index+1] ?? recording.control_steps;
      if (end <= start) return;
      context.globalAlpha = index === active ? 1 : .65;
      context.strokeStyle = durationColor(recording.skill_durations[index]);
      context.lineWidth = index === active ? 4 : 3;
      context.beginPath();
      for (let i=start; i<=end; i++) {
        const state = recording.states[i];
        if (i === start) context.moveTo(state[0],state[1]); else context.lineTo(state[0],state[1]);
      }
      context.stroke();
    });
    context.restore();
  }
  function seekFrame(nextFrame) {
    if (!recording) return;
    frame = Math.max(0, Math.min(recording.control_steps, nextFrame));
    position = frame; lastTimestamp = null;
    render();
  }
  function seekSkill(index) {
    if (!recording?.cycle_starts || index < 0 || index >= recording.cycle_starts.length) return;
    seekFrame(recording.cycle_starts[index]);
  }
  function buildTimeline() {
    timeline.replaceChildren();
    recording?.cycle_starts?.forEach((start,index) => {
      const end = recording.cycle_starts[index+1] ?? recording.control_steps, duration = recording.skill_durations[index];
      const button = document.createElement('button');
      button.type = 'button'; button.style.flexGrow = String(end-start);
      button.style.setProperty('--skill-color', durationColor(duration));
      Object.assign(button.dataset, {skill:String(index), start:String(start), end:String(end), duration:String(duration)});
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
    if (!recording) return;
    scene(ctx,canvas,recording,recording.states[frame],drawRecordedPath);
    canvas.dataset.frame = String(frame);
    el('rollout-step').textContent = `${frame} / ${recording.control_steps}`;
    el('rollout-time').textContent = `${(frame/recording.control_hz).toFixed(1)} s`;
    el('rollout-scrub').value = String(frame);
    if (method !== 'ours') return;
    const starts = recording.cycle_starts, skillIndex = activeSkill();
    const start = starts[skillIndex], end = starts[skillIndex+1] ?? recording.control_steps, duration = recording.skill_durations[skillIndex];
    el('rollout-skill').textContent = `${skillIndex+1} / ${starts.length}`;
    el('skill-duration').textContent = `${duration} actions · ${(duration/recording.control_hz).toFixed(1)} s`;
    el('skill-progress').textContent = `Recorded Execution: ${frame-start} / ${end-start} actions`;
    el('skill-swatch').style.backgroundColor = durationColor(duration);
    el('skill-prev').disabled = skillIndex === 0; el('skill-next').disabled = skillIndex === starts.length-1;
    Array.from(timeline.children).forEach((button,index) => {
      button.setAttribute('aria-pressed', String(index === skillIndex)); button.tabIndex = index === skillIndex ? 0 : -1;
    });
    el('timeline-cursor').style.left = `${frame/recording.control_steps*100}%`;
  }
  function stopRollout() {
    playing = false; lastTimestamp = null;
    cancelAnimationFrame(rolloutRAF); rolloutRAF = null;
    el('rollout-play').textContent = 'Play Rollout'; el('rollout-play').setAttribute('aria-pressed','false');
  }
  function selectRecording(key, nextOutcome = outcome, nextEpisode) {
    if (!recordings) return;
    stopRollout(); selected = key;
    if (method !== 'ours') compute = 'high';
    const groups = episodeGroups();
    if (!groups?.[nextOutcome]?.length) nextOutcome = groups?.success?.length ? 'success' : 'failure';
    outcome = nextOutcome;
    const episodes = groups?.[outcome] ?? [];
    episodeIndex = Math.max(0, Math.min(episodes.length-1, nextEpisode ?? episodeMemory.get(memoryKey()) ?? 0));
    recording = episodes[episodeIndex] ?? null; frame = 0; position = 0;
    if (recording) episodeMemory.set(memoryKey(), episodeIndex);
    el('rollout-episode').replaceChildren(...episodes.map((row,index) => {
      const option = document.createElement('option'); option.value = String(index);
      option.textContent = `${index+1} of ${episodes.length}`; return option;
    }));
    el('rollout-episode').value = String(episodeIndex);
    el('episode-prev').disabled = !recording || episodeIndex === 0;
    el('episode-next').disabled = !recording || episodeIndex === episodes.length-1;
    ['rollout-play','rollout-restart','rollout-scrub','rollout-episode'].forEach(id => el(id).disabled = !recording);
    el('rollout-title').textContent = environmentNames[key];
    el('selected-method-name').textContent = methodLabel(method);
    canvas.hidden = !recording;
    if (!recording) ctx.clearRect(0,0,canvas.width,canvas.height);
    el('recording-unavailable').hidden = Boolean(recording);
    el('execution-controls').hidden = !recording;
    el('skill-details').hidden = method !== 'ours';
    if (recording) {
      el('rollout-scrub').max = String(recording.control_steps);
      el('episode-duration').textContent = `${(recording.control_steps/recording.control_hz).toFixed(1)} s`;
      canvas.setAttribute('aria-label', `${environmentNames[key]}: ${methodLabel(method)}, ${outcome}, episode ${episodeIndex+1} of ${episodes.length}`);
      canvas.dataset.recordingId = recording.recording_id;
    } else { delete canvas.dataset.recordingId; delete canvas.dataset.frame; }
    document.querySelectorAll('[data-outcome]').forEach(button => {
      const count = groups?.[button.dataset.outcome]?.length ?? 0;
      button.setAttribute('aria-pressed', String(button.dataset.outcome === outcome && Boolean(recording)));
      button.disabled = count === 0;
      button.textContent = `${button.dataset.outcome === 'success' ? 'Success' : 'Failure'} (${count})`;
    });
    document.querySelectorAll('[data-rollout]').forEach(button => { button.disabled=false; button.setAttribute('aria-pressed', String(button.dataset.rollout === key)); });
    el('recorded-method').value = method;
    buildTimeline(); render(); updateResults();
  }
  function tick(timestamp) {
    rolloutRAF = null;
    if (!playing || !recording) return;
    if (lastTimestamp !== null) position += Math.min(timestamp-lastTimestamp,250)/1000*recording.control_hz;
    lastTimestamp = timestamp;
    const next = Math.min(recording.control_steps, Math.floor(position));
    if (next !== frame) { frame = next; render(); }
    if (frame === recording.control_steps) stopRollout(); else rolloutRAF = requestAnimationFrame(tick);
  }
  el('rollout-play').addEventListener('click', () => {
    if (!recording) return;
    if (playing) { stopRollout(); return; }
    if (frame === recording.control_steps) seekFrame(0);
    playing = true; lastTimestamp = null;
    el('rollout-play').textContent = 'Pause Rollout'; el('rollout-play').setAttribute('aria-pressed','true');
    rolloutRAF = requestAnimationFrame(tick);
  });
  el('rollout-restart').addEventListener('click', () => selectRecording(selected,outcome,episodeIndex));
  el('rollout-scrub').addEventListener('input', event => seekFrame(Number(event.target.value)));
  document.querySelectorAll('[data-rollout]').forEach(button => button.addEventListener('click', () => { selectRecording(button.dataset.rollout); }));
  document.querySelectorAll('[data-outcome]').forEach(button => button.addEventListener('click', () => selectRecording(selected, button.dataset.outcome)));
  el('rollout-episode').addEventListener('change', event => selectRecording(selected,outcome,Number(event.target.value)));
  el('episode-prev').addEventListener('click', () => selectRecording(selected,outcome,episodeIndex-1));
  el('episode-next').addEventListener('click', () => selectRecording(selected,outcome,episodeIndex+1));
  el('skill-prev').addEventListener('click', () => seekSkill(activeSkill()-1));
  el('skill-next').addEventListener('click', () => seekSkill(activeSkill()+1));
  el('return-ours').addEventListener('click', () => { method='ours'; selectRecording(selected); });
  el('recorded-method').addEventListener('change', event => { method=event.target.value; selectRecording(selected); });
  function buildResults() {
    el('recorded-method').replaceChildren(...['ours',...results.methods.filter(m=>m.group !== 'ours').map(m=>m.id)].map(id => {
      const option = document.createElement('option'); option.value = id; option.textContent = methodLabel(id); return option;
    }));
    el('recorded-method').disabled = false;
    const chart = el('result-chart'); chart.replaceChildren();
    const groups = {ours:'SkillReasoner', play:'Play Data Baselines', expert:'Privileged Expert Demos'};
    for (const [group, label] of Object.entries(groups)) {
      const heading = document.createElement('h4'); heading.textContent = label; chart.append(heading);
      if (group === 'ours') {
        const axis = document.createElement('div'); axis.className = 'bar-axis';
        [0,50,100].forEach(value => { const tick=document.createElement('span'); tick.textContent=`${value}%`; axis.append(tick); });
        chart.append(axis);
        const computeLabel = document.createElement('p'); computeLabel.className = 'compute-label';
        computeLabel.textContent = 'Test-Time Compute'; chart.append(computeLabel);
      }
      for (const row of results.methods.filter(m=>m.group === group)) {
        const button = document.createElement('button'); button.type = 'button'; button.className = `score-row ${group}`;
        button.dataset.method = row.id;
        const label = document.createElement('span'); label.className = 'bar-label';
        label.textContent = group === 'ours' ? row.label.split(' · ')[1] : row.label;
        const track = document.createElement('span'); track.className = 'bar-track'; track.setAttribute('aria-hidden','true');
        const bar = document.createElement('span'); bar.className = 'bar-fill'; bar.style.width = '0%'; track.append(bar);
        const value = document.createElement('span'); value.className = 'bar-value';
        button.append(label,track,value);
        button.addEventListener('click', () => {
          if (row.group === 'ours') { compute=row.id.slice(5); method='ours'; } else method=row.id;
          selectRecording(selected);
        });
        chart.append(button);
      }
    }
  }
  function updateResults() {
    if (!results) return;
    const row = results.environments[selected].full;
    const selectedId = method === 'ours' ? `ours_${compute}` : method;
    const score = row.scores[selectedId];
    const selectedRow = results.methods.find(item => item.id === selectedId);
    el('aggregate-score').textContent = `${score.toFixed(2)}%`;
    el('score-method-name').textContent = method === 'ours' ? selectedRow.label : methodLabel(method);
    el('result-metric').textContent = row.metric;
    document.querySelectorAll('.score-row').forEach(button => {
      const value=row.scores[button.dataset.method], id=button.dataset.method;
      button.querySelector('.bar-value').textContent = `${value.toFixed(2)}%`;
      button.querySelector('.bar-fill').style.width = `${value}%`;
      button.dataset.score=String(value);
      const item=results.methods.find(m=>m.id === id);
      button.setAttribute('aria-pressed', String(id === selectedId));
      button.setAttribute('aria-label', `${item.label}, ${item.group === 'expert' ? 'privileged expert demos' : item.group === 'play' ? 'play data baseline' : 'ours'}, ${value.toFixed(2)} percent normalized task score. View episodes.`);
    });
    el('rollout-error').hidden = true;
  }
  let demoLoaded = false;
  el('load-demo').addEventListener('click', () => {
    if (demoLoaded) return;
    demoLoaded = true; el('load-demo').disabled = true; el('load-demo').textContent = 'Loading…';
    el('status').textContent = 'Loading the demo…';
    const script = document.createElement('script'); script.src = 'demo/app.js?v=try-it-v16';
    script.onerror = () => { demoLoaded = false; el('load-demo').disabled = false; el('load-demo').textContent = 'Retry Loading Demo'; el('status').textContent = 'Unable to load the demo. Please try again.'; };
    document.body.append(script);
  });
  const demoStateObserver = new MutationObserver(() => {
    if (!el('task').disabled) {
      el('load-demo').parentElement.hidden = true;
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
    }), {threshold:0});
    ['learning','method','rollouts','try-it'].forEach(id => observer.observe(el(id)));
    const videos = new IntersectionObserver(entries => entries.forEach(entry => { if (!entry.isIntersecting) entry.target.pause(); }));
    document.querySelectorAll('video').forEach(video => videos.observe(video));
  }
  async function loadRecordings() {
    try {
      const paths = ['assets/rollouts.json', 'assets/results.json', 'assets/baseline-rollouts.json'];
      const data = await Promise.all(paths.map(async path => {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }));
      [recordings, results, baselineRecordings] = data;
      buildResults(); selectRecording(selected);
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
