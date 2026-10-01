"""Browser teleoperation using retained V6.0 physics (800 Hz; responsive browser control batches)."""
import json, math
from types import SimpleNamespace
import pymunk
from physics import step_agent_pd_substep, OFFICIAL_T_BLOCK_POLYGONS

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
        self.task=task
        self.narrow_door_layout=SimpleNamespace(boundary_min=task['bounds'][0],boundary_max=task['bounds'][1])
        self.cache_static_wall_projection=True
        self._static_wall_projection_cache=None
        self.narrow_door_block_wall_projection_count=0
        self.narrow_door_block_wall_projection_max_depth=0.
        self.space=pymunk.Space();self.space.gravity=(0,0);self.space.damping=0.
        self.space.iterations=120;self.space.collision_slop=.0001;self.space.collision_bias=1e-8;self.space.collision_persistence=1
        lo,hi=task['bounds'];mid=(lo+hi)/2;span=hi-lo+96
        def wall(rect):
            x,y,w,h=rect
            body=pymunk.Body(body_type=pymunk.Body.STATIC);body.position=x,y
            shape=pymunk.Poly.create_box(body,(w,h));shape.friction=1.;shape.elasticity=0.
            self.space.add(body,shape)
            return shape
        self.narrow_door_boundary_shapes=tuple(wall(r) for r in [[lo-24,mid,48,span],[hi+24,mid,48,span],[mid,lo-24,span,48],[mid,hi+24,span,48]])
        self.agent=pymunk.Body(body_type=pymunk.Body.KINEMATIC)
        self.agent.position=(task['size']/2,task['size']/2)
        p=pymunk.Circle(self.agent,15);self.space.add(self.agent,p)
        verts=OFFICIAL_T_BLOCK_POLYGONS
        self.block=pymunk.Body(1,2*pymunk.moment_for_poly(1,verts[0]))
        self.parts=[pymunk.Poly(self.block,p) for p in verts]
        self.block.center_of_gravity=(self.parts[0].center_of_gravity+self.parts[1].center_of_gravity)/2
        self.block.position=(task['size']/2,task['size']/2)
        self.space.add(self.block,*self.parts)
        self.narrow_door_wall_shapes=tuple(wall(r) for r in task['walls'])
        # Preserve setup order, default shape friction/filters, and reset stabilization.
        self.agent.position=task['start'][:2];self.agent.velocity=(0,0)
        self.block.angle=task['start'][4];self.block.position=task['start'][2:4]
        self.block.velocity=(0,0);self.block.angular_velocity=0
        if not task.get("recorded_start", False):
            self.space.step(.00125)
        self.target=list(self.agent.position);self.elapsed=0
        self.goals=polygons(task['goal'])
    def step(self,target,steps=80):
        lo,hi=self.task['bounds']
        if type(steps) is not int or not 1<=steps<=80:
            raise ValueError('Invalid physics batch size')
        if len(target)!=2 or any(not math.isfinite(float(v)) or v<lo+15 or v>hi-15 for v in target):
            raise ValueError('Target outside executable workspace')
        self.target=list(target)
        for _ in range(steps):
            step_agent_pd_substep(self,target_x=target[0],target_y=target[1],k_p=100.,k_v=20.,dt=.00125)
        self.elapsed+=steps*.00125
        return self.state()
    def state(self):
        pose=[*self.block.position,self.block.angle];ps=polygons(pose)
        overlap=sum(area(clip_polygon(p,g)) for p in ps for g in self.goals)/6300.
        return dict(pusher=list(self.agent.position),block=pose,overlap=min(1,max(0,overlap)),elapsed=self.elapsed)

sim=None
def reset_task(payload):
    global sim
    from sampling import sample_task
    template=json.loads(payload)
    if template.get('recorded_start', False):
        task=template
        if len(task['start'])!=5 or len(task['goal'])!=3 or not all(math.isfinite(float(v)) for v in task['start']+task['goal']):
            raise ValueError('Invalid recorded start or goal')
    else:
        task=sample_task(template,template['seed'])
    sim=Simulation(task)
    return json.dumps(dict(sim.state(),start=task['start'],goal=task['goal'],seed=task.get('seed'),recording_id=task.get('recording_id')))
def advance(payload):
    request=json.loads(payload)
    if isinstance(request,list):
        return json.dumps(sim.step(request))
    return json.dumps(sim.step(request['target'],steps=request['steps']))
