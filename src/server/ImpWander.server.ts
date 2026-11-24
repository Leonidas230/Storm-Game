const PhysicsService = game.GetService("PhysicsService");
const Workspace = game.GetService("Workspace");

const IMP_COLLISION_GROUP = "ImpNPCs";
const DEFAULT_IMP_MIN_SEPARATION = 200;
const IMP_WALK_SPEED = 12;
const IMP_WANDER_RADIUS = 28;
const IMP_MIN_WANDER_DISTANCE = 5;
const IMP_NEAR_WANDER_DISTANCE = 12;
const IMP_RAYCAST_HEIGHT = 100;
const IMP_RAYCAST_DEPTH = 200;
const IMP_MIN_RUN_SPEED = 11;
const IMP_MAX_RUN_SPEED = 18;
const IMP_RUN_ANIMATION_ID = 80445894671760;
const IMP_DEATH_ANIMATION_ID = 134629653217268;

interface WanderRig {
	model: Model;
	humanoid: Humanoid;
	root: BasePart;
	spawnPosition: Vector3;
	minimumSeparation: number;
	raycastParams: RaycastParams;
	runTrack?: AnimationTrack;
	deathTrack?: AnimationTrack;
	runningConnection?: RBXScriptConnection;
	diedConnection?: RBXScriptConnection;
}

const wanderRigs = new Map<Model, WanderRig>();

if (!PhysicsService.IsCollisionGroupRegistered(IMP_COLLISION_GROUP)) {
	PhysicsService.RegisterCollisionGroup(IMP_COLLISION_GROUP);
}
PhysicsService.CollisionGroupSetCollidable(IMP_COLLISION_GROUP, IMP_COLLISION_GROUP, false);

function isImpModel(model: Model): boolean {
	return model.Name.match("^IMP_").size() > 0;
}

function isFarFromOtherImps(position: Vector3, rig: WanderRig): boolean {
	let isFarEnough = true;
	wanderRigs.forEach((otherRig) => {
		if (otherRig === rig || !otherRig.model.Parent || otherRig.humanoid.Health <= 0) {
			return;
		}

		const minimumSeparation = math.max(rig.minimumSeparation, otherRig.minimumSeparation);
		const minimumDistanceSquared = minimumSeparation * minimumSeparation;
		const deltaX = position.X - otherRig.root.Position.X;
		const deltaZ = position.Z - otherRig.root.Position.Z;
		if (deltaX * deltaX + deltaZ * deltaZ < minimumDistanceSquared) {
			isFarEnough = false;
		}
	});
	return isFarEnough;
}

function loadAnimationTrack(
	animator: Animator,
	animationId: number,
	animationName: string,
): AnimationTrack | undefined {
	const animation = new Instance("Animation");
	animation.AnimationId = `rbxassetid://${animationId}`;
	const [success, track] = pcall(() => animator.LoadAnimation(animation));
	animation.Destroy();
	if (!success) {
		warn(`Failed to load imp ${animationName} animation ${animationId}: ${tostring(track)}`);
		return;
	}
	return track;
}

function configureImpAnimations(rig: WanderRig): void {
	let animator = rig.humanoid.FindFirstChildOfClass("Animator");
	if (!animator) {
		animator = new Instance("Animator");
		animator.Parent = rig.humanoid;
	}

	rig.runTrack = loadAnimationTrack(animator, IMP_RUN_ANIMATION_ID, "run");
	if (rig.runTrack) {
		rig.runTrack.Looped = true;
		rig.runTrack.Priority = Enum.AnimationPriority.Movement;
		rig.runningConnection = rig.humanoid.Running.Connect((speed) => {
			if (speed > 0.1) {
				if (!rig.runTrack?.IsPlaying) {
					rig.runTrack?.Play(0.1);
				}
			} else {
				rig.runTrack?.Stop(0.1);
			}
		});
	}

	rig.deathTrack = loadAnimationTrack(animator, IMP_DEATH_ANIMATION_ID, "death");
	if (rig.deathTrack) {
		rig.deathTrack.Looped = false;
		rig.deathTrack.Priority = Enum.AnimationPriority.Action4;
		rig.diedConnection = rig.humanoid.Died.Connect(() => {
			rig.runTrack?.Stop(0.1);
			rig.deathTrack?.Play(0.1);
		});
	}
}

function findRandomGroundPoint(rig: WanderRig): Vector3 | undefined {
	for (let attempt = 0; attempt < 12; attempt++) {
		const angle = math.random() * math.pi * 2;
		const distance = math.random(
			IMP_MIN_WANDER_DISTANCE,
			math.random() < 0.75 ? IMP_NEAR_WANDER_DISTANCE : IMP_WANDER_RADIUS,
		);
		const candidate = new Vector3(
			rig.spawnPosition.X + math.cos(angle) * distance,
			rig.spawnPosition.Y,
			rig.spawnPosition.Z + math.sin(angle) * distance,
		);

		const rayResult = Workspace.Raycast(
			candidate.add(new Vector3(0, IMP_RAYCAST_HEIGHT, 0)),
			new Vector3(0, -IMP_RAYCAST_DEPTH, 0),
			rig.raycastParams,
		);

		if (!rayResult || !rayResult.Instance.IsA("BasePart")) {
			continue;
		}

		const point = rayResult.Position;
		if (rayResult.Normal.Y < 0.7) {
			continue;
		}

		if (!isFarFromOtherImps(point, rig)) {
			continue;
		}

		const distanceToPoint = point.sub(rig.root.Position).Magnitude;
		if (distanceToPoint >= IMP_MIN_WANDER_DISTANCE) {
			return point.add(new Vector3(0, rig.root.Size.Y / 2 + 0.35, 0));
		}
	}
}

function startWandering(rig: WanderRig): void {
	rig.humanoid.WalkSpeed = IMP_WALK_SPEED;
	rig.humanoid.AutoRotate = true;
	rig.humanoid.PlatformStand = false;
	rig.humanoid.Sit = false;

	task.spawn(() => {
		while (rig.model.Parent && rig.humanoid.Health > 0) {
			const target = findRandomGroundPoint(rig);
			if (!target) {
				warn(`${rig.model.Name} found no wander point near ${rig.spawnPosition}.`);
				task.wait(1);
				continue;
			}

			rig.humanoid.MoveTo(target);
			rig.humanoid.WalkSpeed = math.random(IMP_MIN_RUN_SPEED, IMP_MAX_RUN_SPEED);

			let stuckTime = 0;
			let lastPosition = rig.root.Position;
			let erraticTime = 0;

			while (
				rig.model.Parent &&
				rig.humanoid.Health > 0 &&
				rig.root.Position.sub(target).Magnitude > 4
			) {
				task.wait(0.25);
				if (!isFarFromOtherImps(rig.root.Position, rig)) {
					rig.humanoid.MoveTo(rig.root.Position);
					break;
				}
				erraticTime += 0.25;

				const moved = rig.root.Position.sub(lastPosition).Magnitude;
				if (moved < 0.15) {
					stuckTime += 0.25;
				} else {
					stuckTime = 0;
				}
				lastPosition = rig.root.Position;

				if (erraticTime >= math.random(0.35, 0.9)) {
					erraticTime = 0;
					rig.humanoid.WalkSpeed = math.random(IMP_MIN_RUN_SPEED, IMP_MAX_RUN_SPEED);

					const toTarget = target.sub(rig.root.Position);
					const horizontalTarget = new Vector3(toTarget.X, 0, toTarget.Z);
					if (horizontalTarget.Magnitude > 1) {
						const direction = horizontalTarget.Unit;
						const side = new Vector3(-direction.Z, 0, direction.X);
						const sidestep = (math.random() - 0.5) * math.random(2, 7);
						const erraticTarget = target.add(side.mul(sidestep));
						if (isFarFromOtherImps(erraticTarget, rig)) {
							rig.humanoid.MoveTo(erraticTarget);
						} else if (isFarFromOtherImps(target, rig)) {
							rig.humanoid.MoveTo(target);
						} else {
							rig.humanoid.MoveTo(rig.root.Position);
						}
					}
				}

				if (stuckTime >= 2.5) {
					break;
				}
			}
		}
	});
}

function setupImp(model: Model): void {
	if (wanderRigs.has(model)) {
		return;
	}

	let humanoid = model.FindFirstChildWhichIsA("Humanoid", true);
	let root = model.FindFirstChild("HumanoidRootPart", true);
	if (!root?.IsA("BasePart")) {
		const namedRoot = model.FindFirstChild("HumanoidRootPart");
		root = namedRoot?.IsA("BasePart") ? namedRoot : undefined;
	}

	
	if (!humanoid && root?.IsA("BasePart")) {
		humanoid = new Instance("Humanoid");
		humanoid.Name = "Humanoid";
		humanoid.RequiresNeck = false;
		humanoid.Parent = model;
	}

	if (!humanoid || !root?.IsA("BasePart")) {
		warn(`Cannot configure imp ${model.Name}: missing Humanoid or HumanoidRootPart.`);
		return;
	}

	humanoid.RequiresNeck = false;
	model.GetDescendants().forEach((descendant) => {
		if (descendant.IsA("BasePart")) {
			descendant.Anchored = false;
			descendant.CollisionGroup = IMP_COLLISION_GROUP;
			if (descendant !== root) {
				descendant.Massless = true;
				descendant.CanCollide = false;
			}
		}
	});
	root.Massless = false;
	root.CanCollide = true;
	root.CollisionGroup = IMP_COLLISION_GROUP;
	root.AssemblyLinearVelocity = Vector3.zero;
	root.AssemblyAngularVelocity = Vector3.zero;

	if (model.GetDescendants().filter((descendant) => descendant.IsA("Motor6D")).size() === 0) {
		warn(`Imp ${model.Name} has no Motor6D joints; its animations may not move its parts.`);
	}

	const raycastParams = new RaycastParams();
	raycastParams.FilterType = Enum.RaycastFilterType.Exclude;
	raycastParams.FilterDescendantsInstances = [model];

	const separationAttribute = model.GetAttribute("ImpMinimumSeparation");
	const rig: WanderRig = {
		model,
		humanoid,
		root,
		spawnPosition: root.Position,
		minimumSeparation:
			typeIs(separationAttribute, "number")
				? separationAttribute
				: DEFAULT_IMP_MIN_SEPARATION,
		raycastParams,
	};

	wanderRigs.set(model, rig);
	configureImpAnimations(rig);
	startWandering(rig);
}

function scanForImps(): void {
	Workspace.GetDescendants().forEach((descendant) => {
		if (descendant.IsA("Model") && isImpModel(descendant)) {
			setupImp(descendant);
		}
	});
}

scanForImps();
Workspace.DescendantAdded.Connect((descendant) => {
	task.defer(() => {
		if (descendant.IsA("Model") && isImpModel(descendant)) {
			setupImp(descendant);
		}
	});
});

Workspace.DescendantRemoving.Connect((descendant) => {
	if (descendant.IsA("Model")) {
		const rig = wanderRigs.get(descendant);
		rig?.runningConnection?.Disconnect();
		rig?.diedConnection?.Disconnect();
		rig?.runTrack?.Stop(0);
		rig?.deathTrack?.Stop(0);
		rig?.runTrack?.Destroy();
		rig?.deathTrack?.Destroy();
		wanderRigs.delete(descendant);
	}
});
