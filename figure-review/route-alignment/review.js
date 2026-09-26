'use strict';
const canvas=document.getElementById('alignment'),ctx=canvas.getContext('2d'),slider=document.getElementById('angle');
const points=[[-60,0],[60,0],[60,30],[15,30],[15,120],[-15,120],[-15,30],[-60,30]];
let data;
function shape(angle,fill,stroke,dashed){ctx.save();ctx.rotate(angle);ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.setLineDash(dashed?[4,3]:[]);ctx.stroke();ctx.restore();}
function draw(){if(!data)return;const a=+slider.value,row=data.alignment[a];document.getElementById('degrees').textContent=a+'°';document.getElementById('overlap').textContent=Math.round(row.overlap*100)+'%';document.getElementById('score').textContent=Math.round(row.normalized_task_score*100)+'%';ctx.clearRect(0,0,520,440);ctx.save();ctx.translate(285,120);ctx.scale(2,2);shape(data.goal[2],'#e3e9df','#87917f',false);shape(data.goal[2]+a*Math.PI/180,'#cd8068aa','#a56a56',false);shape(data.goal[2],null,'#87917f',true);ctx.strokeStyle='#252522';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(-4,0);ctx.lineTo(4,0);ctx.moveTo(0,-4);ctx.lineTo(0,4);ctx.stroke();ctx.restore();}
slider.addEventListener('input',draw);fetch('alignment.json').then(r=>r.json()).then(d=>{data=d;draw();}).catch(()=>{document.getElementById('score').textContent='Reload to try again';});
