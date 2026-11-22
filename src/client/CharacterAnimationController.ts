const ContextActionService = game.GetService("ContextActionService");
const ContentProvider = game.GetService("ContentProvider");
const Players = game.GetService("Players");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const RunService = game.GetService("RunService");
const Workspace = game.GetService("Workspace");

export interface CharacterAnimationConfig {
	characterName: "Rage" | "Flood" | "Rain";
	rigAssetId: number;
	idle: string;
	walk: string;
	run: string;
	jump: string;
	fall: string;
	hit: string;
	flight: {
		idle: string;
		forward: string;
		backward: string;
		left: string;
		right: string;
		attack: string;
	};
	attacks: string[];
}

interface FlightAnimationTracks {
	idle?: AnimationTrack;
	forward?: AnimationTrack;
	backward?: AnimationTrack;
	left?: AnimationTrack;
	right?: AnimationTrack;
	attack?: AnimationTrack;
}

interface CharacterAnimationTracks {
	idle?: AnimationTrack;
	walk?: AnimationTrack;
	run?: AnimationTrack;
	jump?: AnimationTrack;
	fall?: AnimationTrack;
	hit?: AnimationTrack;
	flight: FlightAnimationTracks;
	attacks: AnimationTrack[];
}

const player = Players.LocalPlayer;
const sprintEvent = ReplicatedStorage.WaitForChild("SetCharacterSprint") as RemoteEvent;
const WALK_SPEED = 16;
const SPRINT_SPEED = 24;

function loadTrack(animator: Animator, animationId: string): AnimationTrack | undefined {
	const animation = new Instance("Animation");
	animation.AnimationId = animationId;
	const [preloaded, preloadError] = pcall(() => ContentProvider.PreloadAsync([animation]));
	if (!preloaded) {
		animation.Destroy();
		warn(`Failed to preload character animation ${animationId}: ${tostring(preloadError)}`);
		return;
	}

	const [success, track] = pcall(() => animator.LoadAnimation(animation));
	animation.Destroy();
	if (!success) {
		warn(`Failed to load character animation ${animationId}: ${tostring(track)}`);
		return;
	}
	return track;
}

function stopTrack(track: AnimationTrack | undefined): void {
	track?.Stop(0.1);
}

function stopAllTracks(tracks: CharacterAnimationTracks): void {
	stopTrack(tracks.idle);
	stopTrack(tracks.walk);
	stopTrack(tracks.run);
	stopTrack(tracks.jump);
	stopTrack(tracks.fall);
	stopTrack(tracks.hit);
	stopTrack(tracks.flight.idle);
	stopTrack(tracks.flight.forward);
	stopTrack(tracks.flight.backward);
	stopTrack(tracks.flight.left);
	stopTrack(tracks.flight.right);
	stopTrack(tracks.flight.attack);
	tracks.attacks.forEach((track) => track.Stop(0.1));

	tracks.idle?.Destroy();
	tracks.walk?.Destroy();
	tracks.run?.Destroy();
	tracks.jump?.Destroy();
	tracks.fall?.Destroy();
	tracks.hit?.Destroy();
	tracks.flight.idle?.Destroy();
	tracks.flight.forward?.Destroy();
	tracks.flight.backward?.Destroy();
	tracks.flight.left?.Destroy();
	tracks.flight.right?.Destroy();
	tracks.flight.attack?.Destroy();
	tracks.attacks.forEach((track) => track.Destroy());
}

function loadCharacterTracks(animator: Animator, config: CharacterAnimationConfig): CharacterAnimationTracks {
	const idle = loadTrack(animator, config.idle);
	const walk = loadTrack(animator, config.walk);
	const run = loadTrack(animator, config.run);
	const jump = loadTrack(animator, config.jump);
	const fall = loadTrack(animator, config.fall);
	const hit = loadTrack(animator, config.hit);
	const flight: FlightAnimationTracks = {
		idle: loadTrack(animator, config.flight.idle),
		forward: loadTrack(animator, config.flight.forward),
		backward: loadTrack(animator, config.flight.backward),
		left: loadTrack(animator, config.flight.left),
		right: loadTrack(animator, config.flight.right),
		attack: loadTrack(animator, config.flight.attack),
	};
	const attacks: AnimationTrack[] = [];
	config.attacks.forEach((animationId) => {
		const track = loadTrack(animator, animationId);
		if (track) {
			attacks.push(track);
		}
	});

	if (idle) {
		idle.Looped = true;
		idle.Priority = Enum.AnimationPriority.Idle;
	}
	if (walk) {
		walk.Looped = true;
		walk.Priority = Enum.AnimationPriority.Movement;
	}
	if (run) {
		run.Looped = true;
		run.Priority = Enum.AnimationPriority.Movement;
	}
	if (jump) {
		jump.Looped = false;
		jump.Priority = Enum.AnimationPriority.Action;
	}
	if (fall) {
		fall.Looped = true;
		fall.Priority = Enum.AnimationPriority.Action;
	}
	if (hit) {
		hit.Looped = false;
		hit.Priority = Enum.AnimationPriority.Action4;
	}
	const setFlightTrack = (track: AnimationTrack | undefined, priority: Enum.AnimationPriority) => {
		if (!track) {
			return;
		}
		track.Looped = true;
		track.Priority = priority;
	};
	setFlightTrack(flight.idle, Enum.AnimationPriority.Action);
	setFlightTrack(flight.forward, Enum.AnimationPriority.Action);
	setFlightTrack(flight.backward, Enum.AnimationPriority.Action);
	setFlightTrack(flight.left, Enum.AnimationPriority.Action);
	setFlightTrack(flight.right, Enum.AnimationPriority.Action);
	setFlightTrack(flight.attack, Enum.AnimationPriority.Action4);
	attacks.forEach((track) => {
		track.Looped = false;
		track.Priority = Enum.AnimationPriority.Action4;
	});

	return { idle, walk, run, jump, fall, hit, flight, attacks };
}

export function configureCharacterAnimations(config: CharacterAnimationConfig): void {
	let activeCharacter: Model | undefined;
	let humanoid: Humanoid | undefined;
	let tracks: CharacterAnimationTracks | undefined;
	let activeFlightTrack: AnimationTrack | undefined;
	let activeAttackTrack: AnimationTrack | undefined;
	let runningConnection: RBXScriptConnection | undefined;
	let stateConnection: RBXScriptConnection | undefined;
	let healthConnection: RBXScriptConnection | undefined;
	let recoveryConnection: RBXScriptConnection | undefined;
	let attackConnection: RBXScriptConnection | undefined;
	let flightActiveConnection: RBXScriptConnection | undefined;
	let flightDirectionConnection: RBXScriptConnection | undefined;
	let flightAttackConnection: RBXScriptConnection | undefined;
	let brakingConnection: RBXScriptConnection | undefined;
	let cameraConnection: RBXScriptConnection | undefined;
	let isSprinting = false;
	let previousHealth = 0;
	let nextAttackIndex = 0;
	let setupGeneration = 0;

	const isActiveCharacter = (character: Model): boolean =>
		player.GetAttribute("SelectedCharacter") === config.characterName &&
		character.GetAttribute("TestRigAssetId") === config.rigAssetId;

	function disconnectCharacterConnections(): void {
		runningConnection?.Disconnect();
		stateConnection?.Disconnect();
		healthConnection?.Disconnect();
		recoveryConnection?.Disconnect();
		attackConnection?.Disconnect();
		flightActiveConnection?.Disconnect();
		flightDirectionConnection?.Disconnect();
		flightAttackConnection?.Disconnect();
		brakingConnection?.Disconnect();
		cameraConnection?.Disconnect();
		runningConnection = undefined;
		stateConnection = undefined;
		healthConnection = undefined;
		recoveryConnection = undefined;
		attackConnection = undefined;
		flightActiveConnection = undefined;
		flightDirectionConnection = undefined;
		flightAttackConnection = undefined;
		brakingConnection = undefined;
		cameraConnection = undefined;
	}

	function clearTracks(): void {
		if (tracks) {
			stopAllTracks(tracks);
			tracks = undefined;
		}
		activeFlightTrack = undefined;
		activeAttackTrack = undefined;
	}

	function stopGroundTracks(): void {
		if (!tracks) {
			return;
		}
		stopTrack(tracks.idle);
		stopTrack(tracks.walk);
		stopTrack(tracks.run);
		stopTrack(tracks.jump);
		stopTrack(tracks.fall);
	}

	function updateGroundAnimation(speed: number): void {
		if (!tracks || !humanoid || activeCharacter?.GetAttribute("FlightActive") === true) {
			return;
		}

		const state = humanoid.GetState();
		if (
			state === Enum.HumanoidStateType.Jumping ||
			state === Enum.HumanoidStateType.Freefall ||
			state === Enum.HumanoidStateType.FallingDown
		) {
			stopTrack(tracks.idle);
			stopTrack(tracks.walk);
			stopTrack(tracks.run);
			return;
		}

		if (speed > 0.1) {
			stopTrack(tracks.fall);
			stopTrack(tracks.idle);
			const movementTrack = isSprinting ? tracks.run : tracks.walk;
			const inactiveTrack = isSprinting ? tracks.walk : tracks.run;
			stopTrack(inactiveTrack);
			if (movementTrack && !movementTrack.IsPlaying) {
				movementTrack.Play(0.1);
			}
			movementTrack?.AdjustSpeed(
				math.clamp(speed / (isSprinting ? SPRINT_SPEED : WALK_SPEED), 0.1, 1.5),
			);
		} else {
			stopTrack(tracks.fall);
			stopTrack(tracks.walk);
			stopTrack(tracks.run);
			if (tracks.idle && !tracks.idle.IsPlaying) {
				tracks.idle.Play(0.1);
			}
		}
	}

	function updateFlightAnimation(): void {
		if (!activeCharacter || !tracks) {
			return;
		}
		if (activeCharacter.GetAttribute("FlightActive") !== true) {
			activeFlightTrack?.Stop(0.15);
			activeFlightTrack = undefined;
			return;
		}

		stopGroundTracks();
		if (activeCharacter.GetAttribute("FlyChargeActive") === true) {
			activeFlightTrack?.Stop(0.15);
			activeFlightTrack = tracks.flight.attack;
			if (activeFlightTrack && !activeFlightTrack.IsPlaying) {
				activeFlightTrack.Play(0.15);
			}
			if (!activeFlightTrack) {
				warn(`${config.characterName} flight attack animation did not load.`);
			}
			return;
		}

		tracks.flight.attack?.Stop(0.15);
		const direction = activeCharacter.GetAttribute("FlightDirection");
		const nextTrack =
			direction === "forward"
				? tracks.flight.forward
				: direction === "backward"
					? tracks.flight.backward
					: direction === "left"
						? tracks.flight.left
						: direction === "right"
							? tracks.flight.right
							: tracks.flight.idle;
		if (!nextTrack) {
			warn(`${config.characterName} flight animation for "${tostring(direction)}" did not load.`);
			activeFlightTrack?.Stop(0.15);
			activeFlightTrack = undefined;
			return;
		}
		if (activeFlightTrack === nextTrack && nextTrack.IsPlaying) {
			return;
		}
		activeFlightTrack?.Stop(0.15);
		nextTrack.Play(0.15);
		activeFlightTrack = nextTrack;
	}

	function playAttackAnimation(): void {
		if (!tracks || tracks.attacks.size() === 0) {
			return;
		}
		const nextTrack = tracks.attacks[nextAttackIndex % tracks.attacks.size()];
		activeAttackTrack?.Stop(0.05);
		nextTrack.Play(0.05);
		activeAttackTrack = nextTrack;
		nextAttackIndex++;
	}

	function setCharacter(character: Model): void {
		const generation = ++setupGeneration;
		disconnectCharacterConnections();
		clearTracks();
		activeCharacter = character;
		humanoid = undefined;
		isSprinting = false;
		previousHealth = 0;
		nextAttackIndex = 0;

		if (!isActiveCharacter(character)) {
			return;
		}

		const animateScript = character.FindFirstChild("Animate");
		if (animateScript?.IsA("LocalScript")) {
			animateScript.Disabled = true;
		}

		task.spawn(() => {
			let characterHumanoid = character.FindFirstChildWhichIsA("Humanoid", true);
			let animator = characterHumanoid?.FindFirstChildOfClass("Animator");
			for (let retry = 0; (!characterHumanoid || !animator) && retry < 100; retry++) {
				if (generation !== setupGeneration || player.Character !== character) {
					return;
				}
				task.wait(0.1);
				characterHumanoid = character.FindFirstChildWhichIsA("Humanoid", true);
				animator = characterHumanoid?.FindFirstChildOfClass("Animator");
			}
			if (
				generation !== setupGeneration ||
				player.Character !== character ||
				activeCharacter !== character ||
				!isActiveCharacter(character)
			) {
				return;
			}
			if (!characterHumanoid || !animator) {
				warn(`${config.characterName} animations could not start: the character has no Animator.`);
				return;
			}

			humanoid = characterHumanoid;
			const setCameraSubject = () => {
				const camera = Workspace.CurrentCamera;
				if (camera && player.Character === character) {
					camera.CameraType = Enum.CameraType.Custom;
					camera.CameraSubject = characterHumanoid;
				}
			};
			cameraConnection = Workspace.GetPropertyChangedSignal("CurrentCamera").Connect(setCameraSubject);
			setCameraSubject();
			tracks = loadCharacterTracks(animator, config);
			previousHealth = humanoid.Health;
			runningConnection = humanoid.Running.Connect((speed) => updateGroundAnimation(speed));
			stateConnection = humanoid.StateChanged.Connect((_, state) => {
				if (!tracks || activeCharacter?.GetAttribute("FlightActive") === true) {
					return;
				}
				if (state === Enum.HumanoidStateType.Jumping) {
					stopTrack(tracks.idle);
					stopTrack(tracks.walk);
					stopTrack(tracks.run);
					stopTrack(tracks.fall);
					if (tracks.jump && !tracks.jump.IsPlaying) {
						tracks.jump.Play(0.05);
					}
				} else if (
					state === Enum.HumanoidStateType.Freefall ||
					state === Enum.HumanoidStateType.FallingDown
				) {
					stopTrack(tracks.idle);
					stopTrack(tracks.walk);
					stopTrack(tracks.run);
					stopTrack(tracks.jump);
					if (tracks.fall && !tracks.fall.IsPlaying) {
						tracks.fall.Play(0.1);
					}
				} else if (
					state === Enum.HumanoidStateType.Landed ||
					state === Enum.HumanoidStateType.Running
				) {
					stopTrack(tracks.jump);
					stopTrack(tracks.fall);
					updateGroundAnimation(humanoid!.MoveDirection.Magnitude * humanoid!.WalkSpeed);
				}
			});
			healthConnection = humanoid.HealthChanged.Connect((health) => {
				if (health < previousHealth && humanoid!.Health > 0 && tracks?.hit) {
					tracks.hit.Stop(0);
					tracks.hit.Play(0.05);
				}
				previousHealth = health;
			});
			recoveryConnection = character
				.GetAttributeChangedSignal("LandingRecoveryActive")
				.Connect(() => {
					if (character.GetAttribute("LandingRecoveryActive") === true && isSprinting) {
						isSprinting = false;
						sprintEvent.FireServer(false);
						updateGroundAnimation(0);
					}
				});
			attackConnection = character
				.GetAttributeChangedSignal("AttackAnimationRequest")
				.Connect(playAttackAnimation);
			flightActiveConnection = character
				.GetAttributeChangedSignal("FlightActive")
				.Connect(updateFlightAnimation);
			flightDirectionConnection = character
				.GetAttributeChangedSignal("FlightDirection")
				.Connect(updateFlightAnimation);
			flightAttackConnection = character
				.GetAttributeChangedSignal("FlyChargeActive")
				.Connect(updateFlightAnimation);

			const root = character.FindFirstChild("HumanoidRootPart", true);
			if (root?.IsA("BasePart")) {
				brakingConnection = RunService.Heartbeat.Connect(() => {
					if (player.Character !== character || humanoid!.FloorMaterial === Enum.Material.Air) {
						return;
					}
					const velocity = root.AssemblyLinearVelocity;
					const horizontalVelocity = new Vector3(velocity.X, 0, velocity.Z);
					const moveDirection = humanoid!.MoveDirection;
					const horizontalMoveDirection = new Vector3(moveDirection.X, 0, moveDirection.Z);
					const isMoving = moveDirection.Magnitude > 0.05;
					const isChangingDirection =
						isMoving &&
						horizontalVelocity.Magnitude > 0.1 &&
						horizontalMoveDirection.Magnitude > 0.05 &&
						horizontalVelocity.Unit.Dot(horizontalMoveDirection.Unit) < 0.5;
					if ((!isMoving && horizontalVelocity.Magnitude > 0.1) || isChangingDirection) {
						root.AssemblyLinearVelocity = new Vector3(0, velocity.Y, 0);
					}
				});
			}

			updateFlightAnimation();
			if (character.GetAttribute("FlightActive") !== true) {
				updateGroundAnimation(0);
			}
		});
	}

	ContextActionService.BindAction(`Sprint_${config.characterName}`, (_actionName, inputState) => {
		const character = player.Character;
		const canSprint =
			character !== undefined &&
			isActiveCharacter(character) &&
			character.GetAttribute("LandingRecoveryActive") !== true;
		if (!canSprint) {
			isSprinting = false;
			return Enum.ContextActionResult.Pass;
		}

		if (inputState === Enum.UserInputState.Begin && !isSprinting) {
			isSprinting = true;
			sprintEvent.FireServer(true);
		} else if (
			(inputState === Enum.UserInputState.End || inputState === Enum.UserInputState.Cancel) &&
			isSprinting
		) {
			isSprinting = false;
			sprintEvent.FireServer(false);
		}
		if (humanoid) {
			updateGroundAnimation(
				humanoid.MoveDirection.Magnitude * (isSprinting ? SPRINT_SPEED : WALK_SPEED),
			);
		}
		return Enum.ContextActionResult.Pass;
	}, false, Enum.KeyCode.LeftShift, Enum.KeyCode.RightShift);

	player.CharacterAdded.Connect((character) => {
		setCharacter(character);
		character.GetAttributeChangedSignal("TestRigAssetId").Connect(() => setCharacter(character));
	});
	player.GetAttributeChangedSignal("SelectedCharacter").Connect(() => {
		if (player.Character) {
			setCharacter(player.Character);
		}
	});
	if (player.Character) {
		setCharacter(player.Character);
	}
}
