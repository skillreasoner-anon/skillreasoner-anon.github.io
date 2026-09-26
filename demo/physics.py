"""Retained V6.0 integration and wall corrections, exported from the simulator."""
from __future__ import annotations
from dataclasses import dataclass
import math
import numpy as np
import pymunk
AGENT_RADIUS = 15
BLOCK_WALL_PROJECTION_MAX_ITERATIONS = 8
BLOCK_WALL_PROJECTION_PADDING = 1e-4
BLOCK_WALL_PROJECTION_EPS = 1e-9
@dataclass(frozen=True)
class Pose2D:
    x: float
    y: float
    theta: float
OFFICIAL_T_BLOCK_POLYGONS = (((-60., 30.), (60., 30.), (60., 0.), (-60., 0.)), ((-15., 30.), (-15., 120.), (15., 120.), (15., 30.)))
def is_pusher_block_projection_mode(env):
    return False

def is_hardened_workspace_boundary_mode(env):
    return True


def _pusher_workspace_bounds(env: NarrowDoorPushTEnv) -> tuple[float, float]:
    lower = float(env.narrow_door_layout.boundary_min) + float(AGENT_RADIUS)
    upper = float(env.narrow_door_layout.boundary_max) - float(AGENT_RADIUS)
    if upper <= lower:
        raise ValueError(
            "workspace is too small for pusher radius: "
            f"lower={lower:.3f}, upper={upper:.3f}"
        )
    return lower, upper


def _clip_pusher_velocity_to_workspace(
    env: NarrowDoorPushTEnv,
    *,
    velocity_x: float,
    velocity_y: float,
    dt: float,
) -> tuple[float, float]:
    lower, upper = _pusher_workspace_bounds(env)
    current_x = float(env.agent.position.x)
    current_y = float(env.agent.position.y)
    proposed_x = current_x + float(velocity_x) * float(dt)
    proposed_y = current_y + float(velocity_y) * float(dt)
    clipped_x = float(np.clip(proposed_x, lower, upper))
    clipped_y = float(np.clip(proposed_y, lower, upper))
    return (
        (clipped_x - current_x) / float(dt),
        (clipped_y - current_y) / float(dt),
    )


def _clamp_current_pusher_to_workspace(env: NarrowDoorPushTEnv) -> None:
    lower, upper = _pusher_workspace_bounds(env)
    current_x = float(env.agent.position.x)
    current_y = float(env.agent.position.y)
    clipped_x = float(np.clip(current_x, lower, upper))
    clipped_y = float(np.clip(current_y, lower, upper))
    if clipped_x == current_x and clipped_y == current_y:
        return
    env.agent.position = (clipped_x, clipped_y)
    velocity = env.agent.velocity
    velocity_x = float(velocity.x)
    velocity_y = float(velocity.y)
    if clipped_x != current_x:
        velocity_x = 0.0
    if clipped_y != current_y:
        velocity_y = 0.0
    env.agent.velocity = (velocity_x, velocity_y)


def step_agent_pd_substep(
    env: NarrowDoorPushTEnv,
    *,
    target_x: float,
    target_y: float,
    k_p: float,
    k_v: float,
    dt: float,
) -> None:
    projection_mode = is_pusher_block_projection_mode(env)
    block_pose = _current_block_pose(env) if projection_mode else None
    block_polygons = (
        transform_t_block_polygons(block_pose) if block_pose is not None else ()
    )
    pre_step_wall_near: bool | None = None

    def pre_step_projection_enabled(pusher_position: tuple[float, float]) -> bool:
        nonlocal pre_step_wall_near
        if not projection_mode:
            return False
        if not _is_pusher_near_t_block_polygons(
            env,
            pusher_position=pusher_position,
            block_polygons=block_polygons,
        ):
            return False
        if pre_step_wall_near is None:
            pre_step_wall_near = _are_block_polygons_near_narrow_door_wall(
                env,
                block_polygons=block_polygons,
            )
        return bool(pre_step_wall_near)

    projection_enabled = bool(
        pre_step_projection_enabled(
            (float(env.agent.position.x), float(env.agent.position.y))
        )
    )
    if projection_enabled:
        _project_current_pusher_out_of_block(env, block_pose=block_pose)
    position = env.agent.position
    velocity = env.agent.velocity
    velocity_x = float(velocity.x) + (
        float(k_p) * (float(target_x) - float(position.x)) - float(k_v) * float(velocity.x)
    ) * float(dt)
    velocity_y = float(velocity.y) + (
        float(k_p) * (float(target_y) - float(position.y)) - float(k_v) * float(velocity.y)
    ) * float(dt)
    if is_hardened_workspace_boundary_mode(env):
        velocity_x, velocity_y = _clip_pusher_velocity_to_workspace(
            env,
            velocity_x=velocity_x,
            velocity_y=velocity_y,
            dt=float(dt),
        )
    proposed_position = (
        float(position.x) + float(velocity_x) * float(dt),
        float(position.y) + float(velocity_y) * float(dt),
    )
    if pre_step_projection_enabled(proposed_position):
        velocity_x, velocity_y = _project_agent_velocity_against_block(
            env,
            velocity_x=velocity_x,
            velocity_y=velocity_y,
            dt=float(dt),
            block_pose=block_pose,
        )
        if is_hardened_workspace_boundary_mode(env):
            velocity_x, velocity_y = _clip_pusher_velocity_to_workspace(
                env,
                velocity_x=velocity_x,
                velocity_y=velocity_y,
                dt=float(dt),
            )
    env.agent.velocity = (velocity_x, velocity_y)
    env.space.step(float(dt))
    if is_hardened_workspace_boundary_mode(env):
        _clamp_current_pusher_to_workspace(env)
        _project_current_block_out_of_workspace_and_static_walls(env)
    if projection_mode:
        post_block_pose = _current_block_pose(env)
        post_block_polygons = transform_t_block_polygons(post_block_pose)
        if _is_projection_enabled_for_block_polygons(
            env,
            pusher_position=(float(env.agent.position.x), float(env.agent.position.y)),
            block_polygons=post_block_polygons,
        ):
            _project_current_pusher_out_of_block(env, block_pose=post_block_pose)


def _project_current_block_out_of_workspace_and_static_walls(
    env: NarrowDoorPushTEnv,
) -> None:
    for _ in range(BLOCK_WALL_PROJECTION_MAX_ITERATIONS):
        pose = _current_block_pose(env)
        correction = _t_block_workspace_correction(env, pose=pose)
        if correction is None:
            correction = _t_block_static_wall_correction(env, pose=pose)
        if correction is None:
            return
        _apply_block_translation_correction(env, correction)


def _t_block_workspace_correction(
    env: NarrowDoorPushTEnv,
    *,
    pose: Pose2D,
) -> tuple[float, float, float] | None:
    points = [
        point
        for polygon in transform_t_block_polygons(pose)
        for point in polygon
    ]
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    boundary_min = float(env.narrow_door_layout.boundary_min)
    boundary_max = float(env.narrow_door_layout.boundary_max)

    correction_x = 0.0
    correction_y = 0.0
    if min(xs) < boundary_min:
        correction_x = boundary_min - min(xs) + BLOCK_WALL_PROJECTION_PADDING
    elif max(xs) > boundary_max:
        correction_x = boundary_max - max(xs) - BLOCK_WALL_PROJECTION_PADDING
    if min(ys) < boundary_min:
        correction_y = boundary_min - min(ys) + BLOCK_WALL_PROJECTION_PADDING
    elif max(ys) > boundary_max:
        correction_y = boundary_max - max(ys) - BLOCK_WALL_PROJECTION_PADDING

    depth = max(abs(correction_x), abs(correction_y))
    if depth <= BLOCK_WALL_PROJECTION_EPS:
        return None
    return (correction_x, correction_y, depth)


def _t_block_static_wall_correction(
    env: NarrowDoorPushTEnv,
    *,
    pose: Pose2D,
) -> tuple[float, float, float] | None:
    if getattr(env, "cache_static_wall_projection", False):
        return _cached_t_block_static_wall_correction(env, pose=pose)
    obstacle_polygons = tuple(
        _poly_shape_world_vertices(shape)
        for shape in env.narrow_door_wall_shapes
        if isinstance(shape, pymunk.Poly)
    )
    if not obstacle_polygons:
        return None

    best: tuple[float, float, float] | None = None
    for block_polygon in transform_t_block_polygons(pose):
        for obstacle_polygon in obstacle_polygons:
            correction = _convex_polygon_separation_correction(
                moving_polygon=block_polygon,
                obstacle_polygon=obstacle_polygon,
            )
            if correction is None:
                continue
            if best is None or abs(correction[2]) < abs(best[2]):
                best = correction
    return best


def _cached_t_block_static_wall_correction(env, *, pose):
    """Exact SAT with static geometry reuse and conservative AABB rejection.

    Opt-in for immutable scene geometry. _setup invalidates the cache; callers
    editing existing wall vertices/transforms must invalidate it explicitly.
    Narrow Door production scenes keep these shapes static until next reset.
    """
    cached = env._static_wall_projection_cache
    if cached is None or cached[0] is not env.narrow_door_wall_shapes:
        obstacles = []
        for shape in env.narrow_door_wall_shapes:
            if isinstance(shape, pymunk.Poly):
                polygon = _poly_shape_world_vertices(shape)
                obstacles.append((polygon, _polygon_unit_axes(polygon), _polygon_bounds(polygon)))
        cached = (env.narrow_door_wall_shapes, obstacles)
        env._static_wall_projection_cache = cached
    best = None
    for polygon in transform_t_block_polygons(pose):
        axes = None
        xmin, xmax, ymin, ymax = _polygon_bounds(polygon)
        for obstacle, obstacle_axes, (oxmin, oxmax, oymin, oymax) in cached[1]:
            # Leave contact/near-contact to the identical narrow-phase math.
            if (xmax < oxmin - 1e-6 or oxmax < xmin - 1e-6
                    or ymax < oymin - 1e-6 or oymax < ymin - 1e-6):
                continue
            if axes is None:
                axes = _polygon_unit_axes(polygon)
            correction = _convex_polygon_separation_correction(
                moving_polygon=polygon, obstacle_polygon=obstacle,
                axes=axes + obstacle_axes)
            if correction is not None and (best is None or abs(correction[2]) < abs(best[2])):
                best = correction
    return best


def _polygon_bounds(polygon):
    xs = [float(p[0]) for p in polygon]
    ys = [float(p[1]) for p in polygon]
    return min(xs), max(xs), min(ys), max(ys)


def _apply_block_translation_correction(
    env: NarrowDoorPushTEnv,
    correction: tuple[float, float, float],
) -> None:
    correction_x, correction_y, depth = correction
    if float(depth) <= BLOCK_WALL_PROJECTION_EPS:
        return

    old_position = env.block.position
    env.block.position = (
        float(old_position.x) + float(correction_x),
        float(old_position.y) + float(correction_y),
    )
    env.narrow_door_block_wall_projection_count += 1
    env.narrow_door_block_wall_projection_max_depth = max(
        float(env.narrow_door_block_wall_projection_max_depth),
        float(depth),
    )

    correction_norm = float(np.hypot(float(correction_x), float(correction_y)))
    if correction_norm <= BLOCK_WALL_PROJECTION_EPS:
        return
    normal_x = float(correction_x) / correction_norm
    normal_y = float(correction_y) / correction_norm
    velocity = env.block.velocity
    inward_velocity = float(velocity.x) * normal_x + float(velocity.y) * normal_y
    if inward_velocity < 0.0:
        env.block.velocity = (
            float(velocity.x) - inward_velocity * normal_x,
            float(velocity.y) - inward_velocity * normal_y,
        )
    env.block.angular_velocity = 0.0


def _poly_shape_world_vertices(
    shape: pymunk.Poly,
) -> tuple[tuple[float, float], ...]:
    return tuple(
        (
            float(point.x),
            float(point.y),
        )
        for point in (shape.body.local_to_world(vertex) for vertex in shape.get_vertices())
    )


def _convex_polygon_separation_correction(
    *,
    moving_polygon: tuple[tuple[float, float], ...],
    obstacle_polygon: tuple[tuple[float, float], ...],
    axes: list[tuple[float, float]] | None = None,
) -> tuple[float, float, float] | None:
    best_vector: tuple[float, float] | None = None
    best_distance = np.inf
    if axes is None:
        axes = _polygon_unit_axes(moving_polygon) + _polygon_unit_axes(obstacle_polygon)
    for axis in axes:
        moving_min, moving_max = _project_polygon_onto_axis(moving_polygon, axis)
        obstacle_min, obstacle_max = _project_polygon_onto_axis(obstacle_polygon, axis)
        if (
            float(moving_max) <= float(obstacle_min) + BLOCK_WALL_PROJECTION_EPS
            or float(obstacle_max) <= float(moving_min) + BLOCK_WALL_PROJECTION_EPS
        ):
            return None
        move_negative = float(moving_max) - float(obstacle_min)
        move_positive = float(obstacle_max) - float(moving_min)
        if move_negative < move_positive:
            signed_distance = -move_negative
        else:
            signed_distance = move_positive
        distance = abs(signed_distance)
        if distance < float(best_distance):
            best_vector = (
                float(axis[0]) * signed_distance,
                float(axis[1]) * signed_distance,
            )
            best_distance = float(distance)
    if best_vector is None or not np.isfinite(best_distance):
        return None
    vector_norm = float(np.hypot(best_vector[0], best_vector[1]))
    if vector_norm <= BLOCK_WALL_PROJECTION_EPS:
        return None
    padded_norm = vector_norm + BLOCK_WALL_PROJECTION_PADDING
    scale = padded_norm / vector_norm
    return (best_vector[0] * scale, best_vector[1] * scale, padded_norm)


def _polygon_unit_axes(
    polygon: tuple[tuple[float, float], ...],
) -> list[tuple[float, float]]:
    axes: list[tuple[float, float]] = []
    for index, point in enumerate(polygon):
        next_point = polygon[(index + 1) % len(polygon)]
        edge_x = float(next_point[0]) - float(point[0])
        edge_y = float(next_point[1]) - float(point[1])
        norm = float(np.hypot(edge_x, edge_y))
        if norm <= BLOCK_WALL_PROJECTION_EPS:
            continue
        axes.append((-edge_y / norm, edge_x / norm))
    return axes


def _project_polygon_onto_axis(
    polygon: tuple[tuple[float, float], ...],
    axis: tuple[float, float],
) -> tuple[float, float]:
    values = [
        float(point[0]) * float(axis[0]) + float(point[1]) * float(axis[1])
        for point in polygon
    ]
    return min(values), max(values)


def _current_block_pose(env: NarrowDoorPushTEnv) -> Pose2D:
    return Pose2D(
        x=float(env.block.position.x),
        y=float(env.block.position.y),
        theta=float(env.block.angle),
    )


def transform_t_block_polygons(pose: Pose2D) -> tuple[tuple[tuple[float, float], ...], ...]:
    cos_t = math.cos(pose.theta)
    sin_t = math.sin(pose.theta)
    transformed: list[tuple[tuple[float, float], ...]] = []
    for polygon in OFFICIAL_T_BLOCK_POLYGONS:
        transformed.append(
            tuple(
                (
                    pose.x + cos_t * x - sin_t * y,
                    pose.y + sin_t * x + cos_t * y,
                )
                for x, y in polygon
            )
        )
    return tuple(transformed)
