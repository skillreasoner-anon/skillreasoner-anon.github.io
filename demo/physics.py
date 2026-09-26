"""Typed physics and contact primitives for Narrow Door v6."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import math
from typing import Any, Iterable, Literal, Mapping

import pymunk


PhysicsProfile = Literal[
    "narrowdoor_v41_kinematic",
    "narrowdoor_v61_dynamic_v41_contact_rotation",
]


@dataclass(frozen=True)
class NarrowDoorV6PhysicsConfig:
    """Complete controller/load physics identity for the paired v6 environments."""

    physics_profile: PhysicsProfile
    controller_mode: Literal["kinematic_pd", "force_limited_dynamic_pd"]
    pusher_body_type: Literal["kinematic", "dynamic"]
    pusher_mass: float | None
    pusher_k_p: float
    pusher_k_v: float
    pusher_max_force: float | None
    pusher_max_speed: float | None
    pusher_wall_collision: bool
    pusher_load_friction: float
    load_linear_deceleration: float
    load_angular_deceleration: float
    nonpenetration_slop: float
    nonpenetration_padding: float
    nonpenetration_max_iterations: int

    def __post_init__(self) -> None:
        if self.physics_profile == "narrowdoor_v41_kinematic":
            expected = ("kinematic_pd", "kinematic", None, None, None, True)
            actual = (
                self.controller_mode,
                self.pusher_body_type,
                self.pusher_mass,
                self.pusher_max_force,
                self.pusher_max_speed,
                self.pusher_wall_collision,
            )
            if actual != expected:
                raise ValueError(
                    "narrowdoor_v41_kinematic requires the retained kinematic "
                    "pusher/controller identity"
                )
        elif self.physics_profile == "narrowdoor_v61_dynamic_v41_contact_rotation":
            if self.controller_mode != "force_limited_dynamic_pd":
                raise ValueError("dynamic v6.1 physics requires force_limited_dynamic_pd")
            if self.pusher_body_type != "dynamic":
                raise ValueError("dynamic v6.1 physics requires a dynamic pusher body")
            if self.pusher_wall_collision:
                raise ValueError("dynamic v6.1 pusher must ghost through walls")
            for name in ("pusher_mass", "pusher_max_force", "pusher_max_speed"):
                value = getattr(self, name)
                if value is None or not math.isfinite(float(value)) or float(value) <= 0.0:
                    raise ValueError(f"{name} must be finite and positive")
        else:
            raise ValueError(f"unsupported physics_profile {self.physics_profile!r}")
        for name in ("pusher_k_p", "pusher_k_v"):
            value = float(getattr(self, name))
            if not math.isfinite(value) or value <= 0.0:
                raise ValueError(f"{name} must be finite and positive")
        for name in (
            "pusher_load_friction",
            "load_linear_deceleration",
            "load_angular_deceleration",
            "nonpenetration_slop",
            "nonpenetration_padding",
        ):
            value = float(getattr(self, name))
            if not math.isfinite(value) or value < 0.0:
                raise ValueError(f"{name} must be finite and non-negative")
        if int(self.nonpenetration_max_iterations) < 0:
            raise ValueError("nonpenetration_max_iterations must be non-negative")

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "NarrowDoorV6PhysicsConfig":
        return cls(**dict(payload))


def narrowdoor_v60_physics_config() -> NarrowDoorV6PhysicsConfig:
    return NarrowDoorV6PhysicsConfig(
        physics_profile="narrowdoor_v41_kinematic",
        controller_mode="kinematic_pd",
        pusher_body_type="kinematic",
        pusher_mass=None,
        pusher_k_p=100.0,
        pusher_k_v=20.0,
        pusher_max_force=None,
        pusher_max_speed=None,
        pusher_wall_collision=True,
        pusher_load_friction=0.0,
        load_linear_deceleration=0.0,
        load_angular_deceleration=0.0,
        nonpenetration_slop=0.0,
        nonpenetration_padding=0.0001,
        nonpenetration_max_iterations=8,
    )


def narrowdoor_v61_physics_config() -> NarrowDoorV6PhysicsConfig:
    return NarrowDoorV6PhysicsConfig(
        physics_profile="narrowdoor_v61_dynamic_v41_contact_rotation",
        controller_mode="force_limited_dynamic_pd",
        pusher_body_type="dynamic",
        pusher_mass=1.0,
        pusher_k_p=60.0,
        pusher_k_v=15.0,
        pusher_max_force=2500.0,
        pusher_max_speed=450.0,
        pusher_wall_collision=False,
        pusher_load_friction=0.0,
        load_linear_deceleration=1000.0,
        load_angular_deceleration=16.0,
        nonpenetration_slop=0.1,
        nonpenetration_padding=0.001,
        nonpenetration_max_iterations=12,
    )


@dataclass(frozen=True)
class BlockWallPenetration:
    depth: float
    outward_normal: tuple[float, float]
    contact_point: tuple[float, float]


@dataclass(frozen=True)
class NonpenetrationResult:
    correction_count: int
    max_depth: float


def apply_force_limited_pd(
    body: pymunk.Body,
    *,
    target: tuple[float, float],
    k_p: float,
    k_v: float,
    max_force: float,
) -> pymunk.Vec2d:
    displacement = pymunk.Vec2d(float(target[0]), float(target[1])) - body.position
    force = displacement * float(k_p) - body.velocity * float(k_v)
    magnitude = float(force.length)
    if magnitude > float(max_force):
        force *= float(max_force) / magnitude
    body.apply_force_at_world_point(force, body.position)
    return force


def integrate_pusher_velocity(
    body: pymunk.Body,
    gravity: tuple[float, float],
    damping: float,
    dt: float,
    *,
    max_speed: float,
) -> None:
    del damping
    pymunk.Body.update_velocity(body, gravity, 1.0, float(dt))
    speed = float(body.velocity.length)
    if speed > float(max_speed):
        body.velocity *= float(max_speed) / speed


def integrate_load_velocity_with_ground_resistance(
    body: pymunk.Body,
    gravity: tuple[float, float],
    damping: float,
    dt: float,
    *,
    linear_deceleration: float,
    angular_deceleration: float,
) -> None:
    del damping
    pymunk.Body.update_velocity(body, gravity, 1.0, float(dt))
    speed = float(body.velocity.length)
    linear_drop = float(linear_deceleration) * float(dt)
    if speed <= linear_drop:
        body.velocity = (0.0, 0.0)
    elif speed > 0.0:
        body.velocity *= (speed - linear_drop) / speed
    angular_velocity = float(body.angular_velocity)
    angular_drop = float(angular_deceleration) * float(dt)
    if abs(angular_velocity) <= angular_drop:
        body.angular_velocity = 0.0
    else:
        body.angular_velocity = math.copysign(
            abs(angular_velocity) - angular_drop,
            angular_velocity,
        )


def remove_inward_contact_velocity(
    body: pymunk.Body,
    *,
    outward_normal: tuple[float, float],
    contact_point: tuple[float, float],
) -> None:
    normal = pymunk.Vec2d(float(outward_normal[0]), float(outward_normal[1]))
    normal_length = float(normal.length)
    if normal_length <= 1e-12:
        return
    normal /= normal_length
    radius = pymunk.Vec2d(float(contact_point[0]), float(contact_point[1])) - body.position
    contact_velocity = body.velocity + pymunk.Vec2d(
        -float(body.angular_velocity) * float(radius.y),
        float(body.angular_velocity) * float(radius.x),
    )
    inward_speed = float(contact_velocity.dot(normal))
    if inward_speed >= 0.0:
        return
    inverse_mass = 1.0 / float(body.mass)
    radius_cross_normal = float(radius.cross(normal))
    inverse_moment = 0.0 if math.isinf(float(body.moment)) else 1.0 / float(body.moment)
    effective_inverse_mass = inverse_mass + radius_cross_normal**2 * inverse_moment
    if effective_inverse_mass <= 0.0:
        return
    impulse_magnitude = -inward_speed / effective_inverse_mass
    body.velocity += normal * (impulse_magnitude * inverse_mass)
    body.angular_velocity += radius_cross_normal * impulse_magnitude * inverse_moment


def deepest_block_wall_penetration(
    block_shapes: Iterable[pymunk.Shape],
    wall_shapes: Iterable[pymunk.Shape],
) -> BlockWallPenetration | None:
    best: BlockWallPenetration | None = None
    for block_shape in block_shapes:
        for wall_shape in wall_shapes:
            if not block_shape.bb.intersects(wall_shape.bb):
                continue
            contacts = block_shape.shapes_collide(wall_shape)
            candidate = _block_wall_penetration_from_contacts(contacts)
            if candidate is not None and (
                best is None or candidate.depth > best.depth
            ):
                best = candidate
    return best


def _block_wall_penetration_from_contacts(
    contacts: pymunk.ContactPointSet,
) -> BlockWallPenetration | None:
    if not contacts.points:
        return None
    point = min(contacts.points, key=lambda candidate: float(candidate.distance))
    depth = max(0.0, -float(point.distance))
    normal = pymunk.Vec2d(-float(contacts.normal.x), -float(contacts.normal.y))
    if depth <= 0.0 or float(normal.length) <= 1e-12:
        return None
    return BlockWallPenetration(
        depth=float(depth),
        outward_normal=(float(normal.x), float(normal.y)),
        contact_point=(float(point.point_a.x), float(point.point_a.y)),
    )


def _deepest_block_wall_penetration_space_query(
    space: pymunk.Space,
    block_shapes: tuple[pymunk.Shape, ...],
    wall_shape_order: Mapping[pymunk.Shape, int],
) -> BlockWallPenetration | None:
    """Match the exact pairwise result while using Chipmunk's broadphase."""

    best: BlockWallPenetration | None = None
    for block_shape in block_shapes:
        contacts = sorted(
            (
                contact
                for contact in space.shape_query(block_shape)
                if contact.shape in wall_shape_order
            ),
            key=lambda contact: wall_shape_order[contact.shape],
        )
        for contact in contacts:
            candidate = _block_wall_penetration_from_contacts(
                contact.contact_point_set
            )
            if candidate is not None and (
                best is None or candidate.depth > best.depth
            ):
                best = candidate
    return best


def enforce_block_wall_nonpenetration(
    space: pymunk.Space,
    block_body: pymunk.Body,
    block_shapes: Iterable[pymunk.Shape],
    wall_shapes: Iterable[pymunk.Shape],
    *,
    slop: float,
    padding: float,
    max_iterations: int,
) -> NonpenetrationResult:
    block_shape_tuple = tuple(block_shapes)
    wall_shape_tuple = tuple(wall_shapes)
    wall_shape_order = {
        wall_shape: index for index, wall_shape in enumerate(wall_shape_tuple)
    }
    correction_count = 0
    max_depth = 0.0
    for _ in range(int(max_iterations)):
        penetration = _deepest_block_wall_penetration_space_query(
            space,
            block_shape_tuple,
            wall_shape_order,
        )
        if penetration is None or penetration.depth <= float(slop):
            break
        max_depth = max(max_depth, penetration.depth)
        remove_inward_contact_velocity(
            block_body,
            outward_normal=penetration.outward_normal,
            contact_point=penetration.contact_point,
        )
        block_body.position += pymunk.Vec2d(*penetration.outward_normal) * (
            penetration.depth + float(padding)
        )
        space.reindex_shapes_for_body(block_body)
        correction_count += 1
    return NonpenetrationResult(correction_count, max_depth)


__all__ = [
    "BlockWallPenetration",
    "NarrowDoorV6PhysicsConfig",
    "NonpenetrationResult",
    "apply_force_limited_pd",
    "deepest_block_wall_penetration",
    "enforce_block_wall_nonpenetration",
    "integrate_load_velocity_with_ground_resistance",
    "integrate_pusher_velocity",
    "narrowdoor_v60_physics_config",
    "narrowdoor_v61_physics_config",
    "remove_inward_contact_velocity",
]
