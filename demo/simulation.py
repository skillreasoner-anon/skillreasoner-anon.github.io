"""Browser teleoperation adapter: paper layouts and force-limited contact physics."""
import json, math
from functools import partial
import pymunk
from physics import apply_force_limited_pd, integrate_pusher_velocity, integrate_load_velocity_with_ground_resistance, enforce_block_wall_nonpenetration

POLYS = [[(-60,0),(60,0),(60,30),(-60,30)], [(-15,30),(15,30),(15,120),(-15,120)]]

def area(p):
    return abs(sum(p[i][0]*p[(i+1)%len(p)][1]-p[(i+1)%len(p)][0]*p[i][1] for i in range(len(p))))/2 if p else 0

def clip_polygon(poly, clip):
    for a,b in zip(clip,clip[1:]+clip[:1]):
        old=poly;poly=[]
        if not old: break
        def side(p):return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
        prev=old[-1];sp=side(prev)
        for cur in old:
            sc=side(cur)
            if (sc>=0)!=(sp>=0):
                t=sp/(sp-sc);poly.append([prev[0]+t*(cur[0]-prev[0]),prev[1]+t*(cur[1]-prev[1])])
            if sc>=0:poly.append(cur)
            prev,sp=cur,sc
    return poly

def polygons(pose):
    x,y,a=pose;c,s=math.cos(a),math.sin(a)
    return [[[x+c*u-s*v,y+s*u+c*v] for u,v in p] for p in POLYS]

class Simulation:
    def __init__(self, task):
        self.task=task;self.space=pymunk.Space();self.space.gravity=(0,0);self.space.damping=1
        self.space.iterations=120;self.space.collision_slop=.0001;self.space.collision_bias=1e-8;self.space.collision_persistence=1
        self.walls=[]
        lo,hi=task['bounds'];mid=(lo+hi)/2;span=hi-lo+96
        for x,y,w,h in task['walls']+[[lo-24,mid,48,span],[hi+24,mid,48,span],[mid,lo-24,span,48],[mid,hi+24,span,48]]:
            body=pymunk.Body(body_type=pymunk.Body.STATIC);body.position=x,y
            shape=pymunk.Poly.create_box(body,(w,h));shape.friction=1;shape.filter=pymunk.ShapeFilter(categories=4,mask=2)
            self.space.add(body,shape);self.walls.append(shape)
        self.block=pymunk.Body(1,2*pymunk.moment_for_poly(1,POLYS[0]));self.parts=[pymunk.Poly(self.block,p) for p in POLYS]
        self.block.center_of_gravity=(self.parts[0].center_of_gravity+self.parts[1].center_of_gravity)/2
        self.block.angle=task['start'][4];self.block.position=task['start'][2:4]
        self.block.velocity_func=partial(integrate_load_velocity_with_ground_resistance,linear_deceleration=1000.,angular_deceleration=16.)
        for p in self.parts:p.friction=1;p.filter=pymunk.ShapeFilter(categories=2,mask=1|4)
        self.space.add(self.block,*self.parts)
        self.agent=pymunk.Body(1,pymunk.moment_for_circle(1,0,15));self.agent.position=task['start'][:2]
        self.agent.velocity_func=partial(integrate_pusher_velocity,max_speed=450.)
        p=pymunk.Circle(self.agent,15);p.friction=0;p.filter=pymunk.ShapeFilter(categories=1,mask=2)
        self.space.add(self.agent,p);self.target=list(self.agent.position);self.elapsed=0
        self.goals=polygons(task['goal'])
    def step(self,target,steps=16):
        lo,hi=self.task['bounds'];self.target=[max(lo+15,min(hi-15,float(v))) for v in target]
        for _ in range(steps):
            apply_force_limited_pd(self.agent,target=tuple(self.target),k_p=60.,k_v=15.,max_force=2500.)
            self.space.step(.00125)
            x,y=self.agent.position;self.agent.position=(max(lo+15,min(hi-15,x)),max(lo+15,min(hi-15,y)))
            enforce_block_wall_nonpenetration(self.space,self.block,self.parts,self.walls,slop=.1,padding=.001,max_iterations=12)
        self.elapsed+=steps*.00125
        return self.state()
    def state(self):
        pose=[*self.block.position,self.block.angle];ps=polygons(pose)
        overlap=sum(area(clip_polygon(p,g)) for p in ps for g in self.goals)/6300.
        return dict(pusher=list(self.agent.position),block=pose,overlap=min(1,max(0,overlap)),elapsed=self.elapsed)

sim=None
def reset_task(payload):
    global sim
    sim=Simulation(json.loads(payload));return json.dumps(sim.state())
def advance(payload):
    return json.dumps(sim.step(json.loads(payload)))
