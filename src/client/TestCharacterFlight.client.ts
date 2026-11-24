const player = game.GetService("Players").LocalPlayer;
const ContextActionService = game.GetService("ContextActionService");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const RunService = game.GetService("RunService");
const UserInputService = game.GetService("UserInputService");
const Workspace = game.GetService("Workspace");

const RIG_ASSET_IDS = {
	Rage: 86906253861216,
	Flood: 116034060175659,
	Rain: 76860276062667,
};
const FLIGHT_SPEED = 45;
const FLIGHT_SPRINT_MULTIPLIER = 2;
const FLIGHT_RESPONSE = 4;
const MAX_FLIGHT_ACCELERATION = 90;
const SPACE_DOUBLE_TAP_WINDOW = 0.8;
const FLY_CHARGE_TIME = 2.1;
const DIVE_SPEED = 160;
const DIVE_RESPONSE = 8;
const MAX_DIVE_ACCELERATION = 600;
const AIM_RAY_LENGTH = 1000;
const LANDING_RECOVERY_TIME = 2;
const LANDING_RECOVERY_RENDER_STEP = "CharacterLandingRecovery";

let activeCharacter: Model | undefined;
let humanoid: Humanoid | undefined;
let root: BasePart | undefined;
let isFlying = false;
let isDiving = false;
let spaceDown = false;
let descendDown = false;
let lastSpaceTapAt = -1;
let flyChargeStartedAt: number | undefined;
let landingTarget: Vector3 | undefined;
let landingMarker: BasePart | undefined;
let landingPointerTemplate: BasePart | undefined;
let attachment: Attachment | undefined;
let flightForce: VectorForce | undefined;
let flightOrientation: AlignOrientation | undefined;
let flightConnection: RBXScriptConnection | undefined;
let stateConnection: RBXScriptConnection | undefined;
let floorTouchConnection: RBXScriptConnection | undefined;
let recoveryCleanup: (() => void) | undefined;
let isRecovering = false;
let isRecoveryRenderStepBound = false;
let setupGeneration = 0;
let currentFlightDirection: string | undefined;
const landingRaycastParams = new RaycastParams();
landingRaycastParams.FilterType = Enum.RaycastFilterType.Exclude;

function isFlightCharacter(character: Model): boolean {
	const selectedCharacter = player.GetAttribute("SelectedCharacter");
	return (
		(selectedCharacter === "Rage" &&
			character.GetAttribute("TestRigAssetId") === RIG_ASSET_IDS.Rage) ||
		(selectedCharacter === "Flood" &&
			character.GetAttribute("TestRigAssetId") === RIG_ASSET_IDS.Flood) ||
		(selectedCharacter === "Rain" &&
			character.GetAttribute("TestRigAssetId") === RIG_ASSET_IDS.Rain)
	);
}

function findCharacterRoot(character: Model): BasePart | undefined {
	const root = character.FindFirstChild("HumanoidRootPart", true);
	if (root?.IsA("BasePart")) {
		return root;
	}
	return character.PrimaryPart;
}

function grounded(): boolean {
	if (!humanoid) {
		return false;
	}

	const state = humanoid.GetState();
	const verticalSpeed = root?.AssemblyLinearVelocity.Y ?? 0;
	return (
		humanoid.FloorMaterial !== Enum.Material.Air &&
		state !== Enum.HumanoidStateType.Jumping &&
		state !== Enum.HumanoidStateType.Freefall &&
		math.abs(verticalSpeed) <= 2
	);
}

function airborne(): boolean {
	if (!humanoid) {
		return false;
	}

	const state = humanoid.GetState();
	return (
		humanoid.FloorMaterial === Enum.Material.Air ||
		state === Enum.HumanoidStateType.Jumping ||
		state === Enum.HumanoidStateType.Freefall ||
		state === Enum.HumanoidStateType.FallingDown ||
		state === Enum.HumanoidStateType.Physics ||
		math.abs(root?.AssemblyLinearVelocity.Y ?? 0) > 2
	);
}

function updateLandingTarget(camera: Camera): Vector3 | undefined {
	if (!activeCharacter || !root) {
		return;
	}

	const currentRootPosition = root.Position;
	const ignoredInstances: Instance[] = [activeCharacter];
	if (landingMarker) {
		ignoredInstances.push(landingMarker);
	}
	if (landingPointerTemplate) {
		ignoredInstances.push(landingPointerTemplate);
	}
	landingRaycastParams.FilterDescendantsInstances = ignoredInstances;
	const aimResult = Workspace.Raycast(
		camera.CFrame.Position,
		camera.CFrame.LookVector.mul(AIM_RAY_LENGTH),
		landingRaycastParams,
	);
	const aimPoint =
		aimResult?.Position ?? camera.CFrame.Position.add(camera.CFrame.LookVector.mul(AIM_RAY_LENGTH));
	function findGroundAt(x: number, z: number): Vector3 | undefined {
		const groundOrigin = new Vector3(
			x,
			math.max(aimPoint.Y, currentRootPosition.Y) + AIM_RAY_LENGTH,
			z,
		);
		return Workspace.Raycast(
			groundOrigin,
			new Vector3(0, -AIM_RAY_LENGTH * 3, 0),
			landingRaycastParams,
		)?.Position;
	}

	let target = findGroundAt(aimPoint.X, aimPoint.Z);
	if (!target) {
		return;
	}

	let horizontalDirection = new Vector3(
		target.X - currentRootPosition.X,
		0,
		target.Z - currentRootPosition.Z,
	);
	if (horizontalDirection.Magnitude <= 0.05) {
		horizontalDirection = new Vector3(camera.CFrame.LookVector.X, 0, camera.CFrame.LookVector.Z);
	}
	if (horizontalDirection.Magnitude <= 0.05) {
		return;
	}
	horizontalDirection = horizontalDirection.Unit;

	for (let attempt = 0; attempt < 3; attempt++) {
		const horizontalDistance = math.max(currentRootPosition.Y - target.Y, 1);
		const projectedGround = findGroundAt(
			currentRootPosition.X + horizontalDirection.X * horizontalDistance,
			currentRootPosition.Z + horizontalDirection.Z * horizontalDistance,
		);
		if (!projectedGround) {
			return;
		}
		target = projectedGround;
	}

	return target;
}

function findLandingPointerTemplate(): BasePart | undefined {
	const pointerContainer =
		ReplicatedStorage.FindFirstChild("PlayersArrow", true) ??
		Workspace.FindFirstChild("PlayersArrow", true);
	const nestedPointer = pointerContainer?.FindFirstChild("Pointer", true);
	if (nestedPointer?.IsA("BasePart")) {
		return nestedPointer;
	}

	const pointer =
		ReplicatedStorage.FindFirstChild("Pointer", true) ?? Workspace.FindFirstChild("Pointer", true);
	return pointer?.IsA("BasePart") ? pointer : undefined;
}

function createLandingMarker(): BasePart {
	landingPointerTemplate = findLandingPointerTemplate();
	let marker: BasePart;
	if (landingPointerTemplate) {
		marker = landingPointerTemplate.Clone();
	} else {
		const fallbackMarker = new Instance("Part");
		fallbackMarker.Shape = Enum.PartType.Ball;
		fallbackMarker.Size = new Vector3(0.8, 0.8, 0.8);
		fallbackMarker.Material = Enum.Material.Neon;
		fallbackMarker.Color = Color3.fromRGB(255, 80, 40);
		marker = fallbackMarker;
		warn("Fly charge landing Pointer was not found; using the fallback marker.");
	}

	marker.Name = "FlyChargeLandingTarget";
	marker.Anchored = true;
	marker.CanCollide = false;
	marker.CanTouch = false;
	marker.CanQuery = false;
	marker.Parent = Workspace;
	return marker;
}

function clearLandingTarget(): void {
	landingMarker?.Destroy();
	landingMarker = undefined;
	landingPointerTemplate = undefined;
	landingTarget = undefined;
}

function cancelFlyCharge(): void {
	flyChargeStartedAt = undefined;
	clearLandingTarget();
	activeCharacter?.SetAttribute("FlyChargeActive", false);
	activeCharacter?.SetAttribute("FlyChargeProgress", 0);
}

function finishLandingRecovery(): void {
	if (isRecoveryRenderStepBound) {
		RunService.UnbindFromRenderStep(LANDING_RECOVERY_RENDER_STEP);
		isRecoveryRenderStepBound = false;
	}
	const cleanup = recoveryCleanup;
	recoveryCleanup = undefined;
	cleanup?.();
	isRecovering = false;
}

function startLandingRecovery(): void {
	if (isRecovering || !humanoid || !root) {
		return;
	}

	isRecovering = true;
	const recoveryHumanoid = humanoid;
	const recoveryRoot = root;
	const recoveryCharacter = activeCharacter;
	const camera = Workspace.CurrentCamera;
	const originalWalkSpeed = recoveryHumanoid.WalkSpeed;
	const originalJumpPower = recoveryHumanoid.JumpPower;
	const originalJumpHeight = recoveryHumanoid.JumpHeight;
	const originalAutoRotate = recoveryHumanoid.AutoRotate;
	const originalUseJumpPower = recoveryHumanoid.UseJumpPower;
	const originalCameraType = camera?.CameraType;
	const originalCameraSubject = camera?.CameraSubject;
	const baseCameraCFrame = camera?.CFrame;
	const baseCameraFocus = camera?.Focus;
	const recoveryStartedAt = os.clock();
	let restoredWalkSpeed = originalWalkSpeed;

	recoveryCharacter?.SetAttribute("LandingRecoveryActive", true);
	recoveryHumanoid.WalkSpeed = 0;
	recoveryHumanoid.JumpPower = 0;
	recoveryHumanoid.JumpHeight = 0;
	recoveryHumanoid.AutoRotate = false;
	recoveryHumanoid.ChangeState(Enum.HumanoidStateType.Running);

	if (camera) {
		camera.CameraType = Enum.CameraType.Scriptable;
	}
	if (!camera) {
		warn("Landing recovery started without a camera; camera shake is unavailable.");
	}

	const walkSpeedChangedConnection = recoveryHumanoid.GetPropertyChangedSignal("WalkSpeed").Connect(
		() => {
			if (recoveryHumanoid.WalkSpeed > 0) {
				restoredWalkSpeed = recoveryHumanoid.WalkSpeed;
				recoveryHumanoid.WalkSpeed = 0;
			}
		},
	);

	recoveryCleanup = () => {
		walkSpeedChangedConnection.Disconnect();
		if (recoveryHumanoid.Parent) {
			recoveryHumanoid.WalkSpeed = restoredWalkSpeed;
			recoveryHumanoid.JumpPower = originalJumpPower;
			recoveryHumanoid.JumpHeight = originalJumpHeight;
			recoveryHumanoid.UseJumpPower = originalUseJumpPower;
			recoveryHumanoid.AutoRotate = originalAutoRotate;
		}
		if (
			camera?.Parent &&
			originalCameraType !== undefined &&
			baseCameraCFrame &&
			baseCameraFocus
		) {
			camera.CameraType = originalCameraType;
			camera.CameraSubject = originalCameraSubject;
			camera.CFrame = baseCameraCFrame;
			camera.Focus = baseCameraFocus;
		}
		recoveryCharacter?.SetAttribute("LandingRecoveryActive", false);
	};

	RunService.BindToRenderStep(
		LANDING_RECOVERY_RENDER_STEP,
		Enum.RenderPriority.Last.Value,
		() => {
			if (!recoveryHumanoid.Parent || !recoveryRoot.Parent) {
				finishLandingRecovery();
				return;
			}

			const elapsed = os.clock() - recoveryStartedAt;
			if (elapsed >= LANDING_RECOVERY_TIME) {
				finishLandingRecovery();
				return;
			}

			recoveryHumanoid.WalkSpeed = 0;
			recoveryHumanoid.JumpPower = 0;
			recoveryHumanoid.JumpHeight = 0;
			recoveryHumanoid.AutoRotate = false;
			recoveryRoot.AssemblyLinearVelocity = Vector3.zero;
			recoveryRoot.AssemblyAngularVelocity = Vector3.zero;
			if (!camera || !baseCameraCFrame || !baseCameraFocus) {
				return;
			}

			const fade = 1 - elapsed / LANDING_RECOVERY_TIME;
			const noiseTime = elapsed * 30;
			const offset = new Vector3(
				math.sin(noiseTime * 1.7) * 0.7 + math.sin(noiseTime * 2.9) * 0.3,
				math.sin(noiseTime * 2.3) * 0.7 + math.sin(noiseTime * 3.7) * 0.3,
				0,
			).mul(1.2 * fade);
			const rotation = CFrame.Angles(
				math.sin(noiseTime * 2.1) * 0.06 * fade,
				math.sin(noiseTime * 2.7) * 0.06 * fade,
				math.sin(noiseTime * 3.3) * 0.06 * fade,
			);
			camera.CFrame = baseCameraCFrame.mul(new CFrame(offset)).mul(rotation);
			camera.Focus = baseCameraFocus;
		},
	);
	isRecoveryRenderStepBound = true;
}

function startFlyCharge(): void {
	if (!isFlying || isDiving || flyChargeStartedAt !== undefined || !activeCharacter) {
		return;
	}

	flyChargeStartedAt = os.clock();
	spaceDown = false;
	descendDown = false;
	if (root) {
		root.AssemblyLinearVelocity = Vector3.zero;
		root.AssemblyAngularVelocity = Vector3.zero;
	}
	landingMarker = createLandingMarker();
	activeCharacter.SetAttribute("FlyChargeActive", true);
	activeCharacter.SetAttribute("FlyChargeProgress", 0);
	print(`${activeCharacter.Name} fly charge started.`);
}

function stopFlying(changeToFreefall = true, stopMomentum = false): void {
	if (!isFlying) {
		return;
	}

	const landedFromDive = stopMomentum && isDiving;
	isFlying = false;
	if (stopMomentum && root) {
		root.AssemblyLinearVelocity = Vector3.zero;
		root.AssemblyAngularVelocity = Vector3.zero;
	}
	isDiving = false;
	flyChargeStartedAt = undefined;
	clearLandingTarget();
	flightConnection?.Disconnect();
	flightConnection = undefined;
	flightForce?.Destroy();
	flightOrientation?.Destroy();
	attachment?.Destroy();
	flightForce = undefined;
	flightOrientation = undefined;
	attachment = undefined;
	activeCharacter?.SetAttribute("FlightActive", false);
	activeCharacter?.SetAttribute("FlyChargeActive", false);
	activeCharacter?.SetAttribute("FlyChargeProgress", 0);
	activeCharacter?.SetAttribute("FlyDiveActive", false);
	currentFlightDirection = undefined;

	if (changeToFreefall && humanoid && humanoid.Parent) {
		humanoid.AutoRotate = true;
		humanoid.ChangeState(Enum.HumanoidStateType.Freefall);
	} else if (humanoid && humanoid.Parent) {
		humanoid.AutoRotate = true;
		if (stopMomentum && root) {
			humanoid.ChangeState(Enum.HumanoidStateType.Running);
			root.AssemblyLinearVelocity = Vector3.zero;
			root.AssemblyAngularVelocity = Vector3.zero;
		}
	}
	if (landedFromDive) {
		startLandingRecovery();
	}
	print("Character flight deactivated.");
}

function startFlying(): void {
	if (!humanoid || !root || !activeCharacter || isFlying || !isFlightCharacter(activeCharacter)) {
		return;
	}

	isFlying = true;
	humanoid.AutoRotate = false;
	print(`${activeCharacter.Name} flight activated.`);
	activeCharacter.SetAttribute("FlightActive", true);
	activeCharacter.SetAttribute("FlightDirection", "idle");
	activeCharacter.SetAttribute("FlyChargeActive", false);
	activeCharacter.SetAttribute("FlyChargeProgress", 0);
	activeCharacter.SetAttribute("FlyDiveActive", false);
	currentFlightDirection = "idle";

	attachment = new Instance("Attachment");
	attachment.Name = "FlightAttachment";
	attachment.Parent = root;

	flightForce = new Instance("VectorForce");
	flightForce.Name = "FlightForce";
	flightForce.Attachment0 = attachment;
	flightForce.ApplyAtCenterOfMass = true;
	flightForce.RelativeTo = Enum.ActuatorRelativeTo.World;
	flightForce.Parent = root;

	flightOrientation = new Instance("AlignOrientation");
	flightOrientation.Name = "FlightOrientation";
	flightOrientation.Mode = Enum.OrientationAlignmentMode.OneAttachment;
	flightOrientation.Attachment0 = attachment;
	flightOrientation.Responsiveness = 8;
	flightOrientation.MaxTorque = 1000000;
	flightOrientation.RigidityEnabled = false;
	flightOrientation.Parent = root;

	humanoid.ChangeState(Enum.HumanoidStateType.Physics);
	flightConnection = RunService.Heartbeat.Connect(() => {
		if (!isFlying || !humanoid || !root || !flightForce || !flightOrientation) {
			return;
		}

		if (humanoid.FloorMaterial !== Enum.Material.Air && root.AssemblyLinearVelocity.Y <= 0) {
			stopFlying(false, true);
			lastSpaceTapAt = -1;
			return;
		}

		const camera = Workspace.CurrentCamera;
		if (!camera) {
			return;
		}

		if (flyChargeStartedAt !== undefined) {
			landingTarget = updateLandingTarget(camera);
			if (landingTarget && landingMarker) {
				landingMarker.Position = landingTarget.add(
					new Vector3(0, landingMarker.Size.Y / 2 + 0.05, 0),
				);
			}

			if (flyChargeStartedAt !== undefined) {
				const chargeProgress = math.clamp((os.clock() - flyChargeStartedAt) / FLY_CHARGE_TIME, 0, 1);
				activeCharacter?.SetAttribute("FlyChargeProgress", chargeProgress);
				if (chargeProgress >= 1) {
					if (!landingTarget) {
						cancelFlyCharge();
						warn("Fly charge failed: no landing surface is within aim range.");
					} else {
						flyChargeStartedAt = undefined;
						isDiving = true;
						activeCharacter?.SetAttribute("FlyChargeActive", false);
						activeCharacter?.SetAttribute("FlyDiveActive", true);
						if (landingMarker) {
							landingMarker.Transparency = 1;
							landingMarker.GetDescendants().forEach((descendant) => {
								if (
									descendant.IsA("BasePart") ||
									descendant.IsA("Decal") ||
									descendant.IsA("Texture")
								) {
									descendant.Transparency = 1;
								}
							});
						}
						const horizontalTarget = new Vector3(
							landingTarget.X - root.Position.X,
							0,
							landingTarget.Z - root.Position.Z,
						);
						if (horizontalTarget.Magnitude > 0.05) {
							root.AssemblyLinearVelocity = horizontalTarget.Unit
								.mul(DIVE_SPEED)
								.add(new Vector3(0, -DIVE_SPEED, 0));
						}
						print("Fly charge released toward the landing target.");
					}
				}
			}
		}

		const forwardInput =
			(UserInputService.IsKeyDown(Enum.KeyCode.W) ? 1 : 0) -
			(UserInputService.IsKeyDown(Enum.KeyCode.S) ? 1 : 0);
		const lateralInput =
			(UserInputService.IsKeyDown(Enum.KeyCode.D) ? 1 : 0) -
			(UserInputService.IsKeyDown(Enum.KeyCode.A) ? 1 : 0);
		let movement = new Vector3();
		if (forwardInput > 0) {
			movement = movement.add(camera.CFrame.LookVector);
		}
		if (forwardInput < 0) {
			movement = movement.sub(camera.CFrame.LookVector);
		}

		const cameraRight = new Vector3(camera.CFrame.RightVector.X, 0, camera.CFrame.RightVector.Z);
		if (cameraRight.Magnitude > 0) {
			const right = cameraRight.Unit;
			if (lateralInput > 0) {
				movement = movement.add(right);
			}
			if (lateralInput < 0) {
				movement = movement.sub(right);
			}
		}

		let animationDirection = "idle";
		if (math.abs(forwardInput) >= math.abs(lateralInput) && forwardInput !== 0) {
			animationDirection = forwardInput > 0 ? "forward" : "backward";
		} else if (lateralInput !== 0) {
			animationDirection = lateralInput > 0 ? "right" : "left";
		}
		if (currentFlightDirection !== animationDirection) {
			activeCharacter?.SetAttribute("FlightDirection", animationDirection);
			currentFlightDirection = animationDirection;
		}

		if (spaceDown) {
			movement = movement.add(Vector3.yAxis);
		}
		if (descendDown) {
			movement = movement.sub(Vector3.yAxis);
		}
		if (movement.Magnitude > 1) {
			movement = movement.Unit;
		}

		const isCharging = flyChargeStartedAt !== undefined;
		const isFlightSprinting =
			UserInputService.IsKeyDown(Enum.KeyCode.LeftShift) ||
			UserInputService.IsKeyDown(Enum.KeyCode.RightShift);
		let targetVelocity = movement.mul(
			FLIGHT_SPEED * (isFlightSprinting ? FLIGHT_SPRINT_MULTIPLIER : 1),
		);
		let response = FLIGHT_RESPONSE;
		let maxAcceleration = MAX_FLIGHT_ACCELERATION;
		if (isCharging) {
			root.AssemblyLinearVelocity = Vector3.zero;
			root.AssemblyAngularVelocity = Vector3.zero;
			targetVelocity = Vector3.zero;
			response = DIVE_RESPONSE;
			maxAcceleration = MAX_DIVE_ACCELERATION;
			movement = Vector3.zero;
		} else if (isDiving && landingTarget) {
			const horizontalTarget = new Vector3(
				landingTarget.X - root.Position.X,
				0,
				landingTarget.Z - root.Position.Z,
			);
			const horizontalVelocity =
				horizontalTarget.Magnitude > 3
					? horizontalTarget.Unit.mul(DIVE_SPEED)
					: Vector3.zero;
			targetVelocity = horizontalVelocity.add(new Vector3(0, -DIVE_SPEED, 0));
			response = DIVE_RESPONSE;
			maxAcceleration = MAX_DIVE_ACCELERATION;
			movement = horizontalVelocity;
		}
		const currentVelocity = root.AssemblyLinearVelocity;
		let acceleration = targetVelocity.sub(currentVelocity).mul(response);
		if (acceleration.Magnitude > maxAcceleration) {
			acceleration = acceleration.Unit.mul(maxAcceleration);
		}
		flightForce.Force = acceleration
			.add(new Vector3(0, Workspace.Gravity, 0))
			.mul(root.AssemblyMass);

		const horizontalFacing = new Vector3(movement.X, 0, movement.Z);
		const cameraFacing = new Vector3(camera.CFrame.LookVector.X, 0, camera.CFrame.LookVector.Z);
		const facing = horizontalFacing.Magnitude > 0.05 ? horizontalFacing : cameraFacing;
		if (facing.Magnitude > 0.05) {
			flightOrientation.CFrame = CFrame.lookAt(Vector3.zero, facing.Unit);
		}
	});
}

function setCharacter(character: Model): void {
	const generation = ++setupGeneration;
	finishLandingRecovery();
	stopFlying(false);
	stateConnection?.Disconnect();
	floorTouchConnection?.Disconnect();
	floorTouchConnection = undefined;
	activeCharacter = character;
	humanoid = undefined;
	root = undefined;
	spaceDown = false;
	descendDown = false;
	lastSpaceTapAt = -1;
	flyChargeStartedAt = undefined;
	clearLandingTarget();
	isDiving = false;

	if (!isFlightCharacter(character)) {
		return;
	}
	character.SetAttribute("FlightActive", false);
	character.SetAttribute("FlightDirection", "idle");
	character.SetAttribute("FlyChargeActive", false);
	character.SetAttribute("FlyChargeProgress", 0);
	character.SetAttribute("FlyDiveActive", false);
	character.SetAttribute("LandingRecoveryActive", false);
	currentFlightDirection = "idle";

	task.spawn(() => {
		let characterHumanoid = character.FindFirstChildWhichIsA("Humanoid", true);
		let characterRoot = findCharacterRoot(character);
		for (let retry = 0; (!characterHumanoid || !characterRoot) && retry < 100; retry++) {
			if (generation !== setupGeneration || player.Character !== character) {
				return;
			}
			task.wait(0.1);
			characterHumanoid = character.FindFirstChildWhichIsA("Humanoid", true);
			characterRoot = findCharacterRoot(character);
		}

		if (
			generation !== setupGeneration ||
			player.Character !== character ||
			activeCharacter !== character ||
			!isFlightCharacter(character)
		) {
			return;
		}

		if (!characterHumanoid || !characterRoot) {
			warn(
				`Test character flight could not start: Humanoid ${characterHumanoid ? "found" : "missing"}, ` +
					`HumanoidRootPart ${characterRoot ? "found" : "missing"}.`,
			);
			return;
		}

		humanoid = characterHumanoid;
		root = characterRoot;
		const floor =
			Workspace.FindFirstChild("MainFloor2", true)?.IsA("BasePart") === true
				? (Workspace.FindFirstChild("MainFloor2", true) as BasePart)
				: Workspace.FindFirstChild("MainFloor", true)?.IsA("BasePart") === true
					? (Workspace.FindFirstChild("MainFloor", true) as BasePart)
					: undefined;
		if (floor) {
			floorTouchConnection = characterRoot.Touched.Connect((touchedPart) => {
				if (
					!isFlying ||
					activeCharacter !== character ||
					player.Character !== character ||
					touchedPart !== floor &&
					touchedPart.Name !== "MainFloor2" &&
					touchedPart.Name !== "MainFloor"
				) {
					return;
				}

				stopFlying(false, true);
				lastSpaceTapAt = -1;
			});
		} else {
			warn("Character flight landing contact could not bind: Workspace has no MainFloor or MainFloor2 part.");
		}

		stateConnection = characterHumanoid.StateChanged.Connect((_, state) => {
			if (state === Enum.HumanoidStateType.Landed) {
				stopFlying(false, true);
				lastSpaceTapAt = -1;
			}
		});
	});
}

ContextActionService.BindActionAtPriority(
	"TestCharacterFlightControls",
	(_actionName, inputState, input) => {
		if (input.KeyCode === Enum.KeyCode.Space) {
			if (inputState === Enum.UserInputState.Begin) {
				if (
					UserInputService.GetFocusedTextBox() ||
					!humanoid ||
					!activeCharacter ||
					!isFlightCharacter(activeCharacter)
				) {
					return Enum.ContextActionResult.Pass;
				}

				spaceDown = true;
				const tapTime = os.clock();
				if (!isFlying && grounded()) {
					lastSpaceTapAt = tapTime;
				} else if (tapTime - lastSpaceTapAt <= SPACE_DOUBLE_TAP_WINDOW) {
					lastSpaceTapAt = -1;
					if (isFlying) {
						stopFlying();
					} else if (airborne()) {
						startFlying();
					} else {
						lastSpaceTapAt = tapTime;
					}
				} else {
					lastSpaceTapAt = tapTime;
				}
			} else if (
				inputState === Enum.UserInputState.End ||
				inputState === Enum.UserInputState.Cancel
			) {
				spaceDown = false;
			}
		} else if (input.KeyCode === Enum.KeyCode.LeftControl) {
			if (inputState === Enum.UserInputState.Begin) {
				descendDown = true;
			} else if (
				inputState === Enum.UserInputState.End ||
				inputState === Enum.UserInputState.Cancel
			) {
				descendDown = false;
			}
		} else if (input.KeyCode === Enum.KeyCode.E) {
			if (
				inputState === Enum.UserInputState.Begin &&
				!UserInputService.GetFocusedTextBox()
			) {
				startFlyCharge();
			} else if (
				(inputState === Enum.UserInputState.End || inputState === Enum.UserInputState.Cancel) &&
				flyChargeStartedAt !== undefined
			) {
				cancelFlyCharge();
			}
		}

		return Enum.ContextActionResult.Pass;
	},
	false,
	Enum.ContextActionPriority.High.Value,
	Enum.KeyCode.Space,
	Enum.KeyCode.LeftControl,
	Enum.KeyCode.E,
);

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
