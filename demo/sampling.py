"""Production pose sampling adapted to the self-contained browser runtime.

Rules are exported from random_pose_previews and v60_layout_family_eval.
NumPy PCG64 and draw order match those samplers. Convex clipping replaces
Shapely for the same complete-T/wall and 64-edge pusher-disk checks.
"""
import math
import numpy as np
from simulation import polygons, clip_polygon, area


def wall_polygon(wall, padding=0):
    x,y,w,h=wall;w=w/2+padding;h=h/2+padding
    return [[x-w,y-h],[x+w,y-h],[x+w,y+h],[x-w,y+h]]


def block_is_open(task, pose):
    parts=polygons(pose);rules=task['sampling'];clearance=rules['family_clearance']
    lo,hi=task['bounds'];lo+=clearance;hi-=clearance
    if any(x<lo or x>hi or y<lo or y>hi for part in parts for x,y in part):
        return False
    for wall in task['walls']:
        clipped=sum(area(clip_polygon(part,wall_polygon(wall))) for part in parts)
        if clipped>rules['min_wall_area']:
            return False
        if clearance and any(area(clip_polygon(part,wall_polygon(wall,clearance)))>0 for part in parts):
            return False
    return True


def agent_is_open(task, agent):
    x,y=agent;lo,hi=task['bounds'];radius=15
    if x-radius<lo or x+radius>hi or y-radius<lo or y+radius>hi:
        return False
    # Shapely Point.buffer(15) uses 16 segments per quadrant in production.
    circle=[[x+radius*math.cos(i*math.pi/32),y+radius*math.sin(i*math.pi/32)] for i in range(64)]
    return all(area(clip_polygon(circle,wall_polygon(wall)))<=task['sampling']['min_wall_area'] for wall in task['walls'])


def room_for(task, point):
    divider=task['sampling']['room_divider'];x,y=point
    return ('south' if y<divider else 'north')+'_'+('west' if x<divider else 'east')


def sample_pose(task, rng, region, with_agent):
    rules=task['sampling']
    for _ in range(rules['max_attempts']):
        x=float(rng.uniform(*region['x']));y=float(rng.uniform(*region['y']))
        theta=math.radians(float(rng.uniform(-180.,180.))) if rules['theta_degrees'] else float(rng.uniform(-math.pi,math.pi))
        pose=[x,y,theta]
        if not block_is_open(task,pose):
            continue
        vertices=[p for part in polygons(pose) for p in part]
        if 'name' in region and any(room_for(task,p)!=region['name'] for p in vertices):
            continue
        if 'left_of' in region and any(p[0]>=region['left_of'] for p in vertices):
            continue
        if 'right_of' in region and any(p[0]<=region['right_of'] for p in vertices):
            continue
        if not with_agent:
            return pose,None
        u,v=rules['agent_local'];c,s=math.cos(theta),math.sin(theta)
        agent=[x+c*u-s*v,y+s*u+c*v]
        if not agent_is_open(task,agent):
            continue
        if 'name' in region and room_for(task,agent)!=region['name']:
            continue
        if 'left_of' in region and agent[0]>=region['left_of']:
            continue
        return pose,agent
    raise RuntimeError('Could not sample a valid start or goal')


def sample_task(template, seed):
    task=dict(template);rules=task['sampling'];rng=np.random.default_rng(int(seed))
    if task['id']=='multi_room':
        rooms=rules['rooms'];start_room=rooms[int(rng.integers(0,len(rooms)))]
        goal_rooms=[r for r in rooms if r['name']!=start_room['name']]
        goal_room=goal_rooms[int(rng.integers(0,len(goal_rooms)))]
    else:
        start_room=rules['start_region'];goal_room=rules['goal_region']
    start,agent=sample_pose(task,rng,start_room,True)
    goal,_=sample_pose(task,rng,goal_room,False)
    task.update(start=agent+start,goal=goal,seed=int(seed))
    return task
