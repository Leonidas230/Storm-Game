const Players = game.GetService("Players");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const AssetService = game.GetService("AssetService");
const ServerStorage = game.GetService("ServerStorage");
const Workspace = game.GetService("Workspace");

const RIG_CHARACTERS = {
	Rage: { assetId: 86906253861216 },
	Flood: { assetId: 116034060175659 },
	Rain: { assetId: 76860276062667 },
};
const TEST_RIG_VISUAL_YAW_OFFSET_DEGREES = 90;
const TEST_RIG_WALK_SPEED = 16;
const TEST_RIG_SPRINT_SPEED = 40;

const characterLoadouts = [
	{ character: "Rage", weapon: "Fists", damage: 35, range: 6, cooldown: 1 },
	{ character: "Flood", weapon: "Sword", damage: 30, range: 8, cooldown: 0.7 },
	{ character: "Rain", weapon: "Bow", damage: 35, range: 250, cooldown: 1 },
];
const RAGE_HITBOX_ACTIVE_TIME = 0.2;
const RAGE_HITBOX_SAMPLE_INTERVAL = 0.05;
const RAGE_HITBOX_VISUAL_TIME = 4;

function getOrCreateRemoteEvent(name: string): RemoteEvent {
	const existing = ReplicatedStorage.FindFirstChild(name);
	if (existing) {
		if (existing.IsA("RemoteEvent")) {
			return existing;
		}

		error(`Cannot create ${name}: an instance with that name already exists.`);
	}

	const remoteEvent = new Instance("RemoteEvent");
	remoteEvent.Name = name;
	remoteEvent.Parent = ReplicatedStorage;
	return remoteEvent;
}

const selectionEvent = getOrCreateRemoteEvent("SelectCharacter");
const abilityEvent = getOrCreateRemoteEvent("UseCharacterAbility");
const sprintEvent = getOrCreateRemoteEvent("SetCharacterSprint");
const nextAttackTime = new Map<Player, number>();

type RigCharacterName = keyof typeof RIG_CHARACTERS;

function findRigCharacter(characterName: string): RigCharacterName | undefined {
	if (characterName === "Rage" || characterName === "Flood" || characterName === "Rain") {
		return characterName;
	}
}

function findLoadout(characterName: string): (typeof characterLoadouts)[number] | undefined {
	return characterLoadouts.find((loadout) => loadout.character === characterName);
}

function isManagedRig(character: Model): boolean {
	const assetId = character.GetAttribute("TestRigAssetId");
	return (
		assetId === RIG_CHARACTERS.Rage.assetId ||
		assetId === RIG_CHARACTERS.Flood.assetId ||
		assetId === RIG_CHARACTERS.Rain.assetId
	);
}

const rigTemplates = new Map<RigCharacterName, Model>();
const originalCharacters = new Map<Player, Model>();

function findHumanoidRig(instance: Instance): Model | undefined {
	for (const child of instance.GetChildren()) {
		const rig = findHumanoidRig(child);
		if (rig) {
			return rig;
		}
	}

	if (instance.IsA("Model") && instance.FindFirstChild("HumanoidRootPart", true)?.IsA("BasePart")) {
		return instance;
	}
}

function getTestRigTemplate(characterName: RigCharacterName): Model | undefined {
	const cachedTemplate = rigTemplates.get(characterName);
	if (cachedTemplate) {
		return cachedTemplate;
	}

	const assetId = RIG_CHARACTERS[characterName].assetId;
	const [success, asset] = pcall(() => AssetService.LoadAssetAsync(assetId));
	if (!success) {
		warn(`Failed to load ${characterName} rig asset ${assetId}: ${tostring(asset)}`);
		return;
	}
	if (!asset) {
		warn(`${characterName} rig asset ${assetId} was not available.`);
		return;
	}

	const rig = findHumanoidRig(asset);
	if (!rig) {
		asset.Destroy();
		warn(`${characterName} rig asset ${assetId} has no Humanoid rig with a HumanoidRootPart.`);
		return;
	}

	rig.GetDescendants().forEach((descendant) => {
		if (descendant.IsA("BaseScript") || descendant.IsA("ModuleScript")) {
			descendant.Destroy();
		}
	});

	if (rig.GetDescendants().filter((descendant) => descendant.IsA("Motor6D")).size() === 0) {
		warn(`${characterName} rig asset ${assetId} has no Motor6D joints; its animations may not move the body parts.`);
	}

	let humanoid = rig.FindFirstChildWhichIsA("Humanoid", true);
	if (!humanoid) {
		humanoid = new Instance("Humanoid");
		humanoid.RequiresNeck = false;
	}
	humanoid.Parent = rig;
	if (humanoid && !humanoid.FindFirstChildOfClass("Animator")) {
		const animator = new Instance("Animator");
		animator.Parent = humanoid;
	}

	rig.Name = `${characterName}RigTemplate`;
	rig.Parent = ServerStorage;
	if (rig !== asset) {
		asset.Destroy();
	}
	rigTemplates.set(characterName, rig);
	return rig;
}

function weldLooseRigParts(rig: Model, root: BasePart): number {
	const attachedParts = root.GetConnectedParts(true);
	attachedParts.push(root);
	const rigParts = rig.GetDescendants().filter((descendant) => descendant.IsA("BasePart"));
	let weldedCount = 0;

	rigParts.forEach((part) => {
		if (attachedParts.includes(part)) {
			return;
		}

		let nearestPart: BasePart | undefined;
		let nearestDistance = math.huge;
		attachedParts.forEach((attachedPart) => {
			const distance = part.Position.sub(attachedPart.Position).Magnitude;
			if (distance < nearestDistance) {
				nearestPart = attachedPart;
				nearestDistance = distance;
			}
		});

		if (!nearestPart) {
			warn(`Could not attach loose rig part ${part.Name}.`);
			return;
		}

		const weld = new Instance("WeldConstraint");
		weld.Name = "TestRigPartWeld";
		weld.Part0 = nearestPart;
		weld.Part1 = part;
		weld.Parent = part;
		attachedParts.push(part);
		part.GetConnectedParts(true).forEach((connectedPart) => {
			if (!attachedParts.includes(connectedPart)) {
				attachedParts.push(connectedPart);
			}
		});
		weldedCount++;
	});

	return weldedCount;
}

function configureTestRigMovement(character: Model): void {
	const humanoid = character.FindFirstChildOfClass("Humanoid");
	const root = character.FindFirstChild("HumanoidRootPart", true);
	if (!humanoid || !root?.IsA("BasePart")) {
		warn(`Cannot configure movement for test rig ${character.Name}: missing Humanoid or HumanoidRootPart.`);
		return;
	}

	character.GetDescendants().forEach((descendant) => {
		if (descendant.IsA("BasePart") && descendant !== root) {
			descendant.Massless = true;
		}
	});

	const volume = root.Size.X * root.Size.Y * root.Size.Z;
	const density = math.clamp(20 / volume, 0.01, 0.7);
	root.Massless = false;
	root.CustomPhysicalProperties = new PhysicalProperties(density, 0.7, 0, 1, 1);
	root.AssemblyLinearVelocity = Vector3.zero;
	root.AssemblyAngularVelocity = Vector3.zero;

	humanoid.WalkSpeed = TEST_RIG_WALK_SPEED;
	humanoid.UseJumpPower = true;
	humanoid.JumpPower = 50;
	humanoid.AutoRotate = true;
	humanoid.PlatformStand = false;
	humanoid.Sit = false;
}

function hideInactiveExpressions(rig: Model): void {
	const expressionNames = [
		"EAngry",
		"EClosed",
		"EExtra",
		"EJoy",
		"ESad",
		"MHappy",
		"MOHappy",
		"MOSad",
		"MSad",
		"MSurprise",
		"MTHappy",
		"MTSad",
	];

	rig.GetDescendants().forEach((instance) => {
		if (instance.Parent && expressionNames.includes(instance.Name)) {
			instance.Destroy();
		}
	});
}

function attachHatToHead(rig: Model): void {
	const head = rig.FindFirstChild("Head", true);
	const hat = rig.FindFirstChild("Hat", true);
	if (!head?.IsA("BasePart") || !hat?.IsA("BasePart")) {
		return;
	}

	rig.GetDescendants().forEach((joint) => {
		if (joint.IsA("JointInstance") && (joint.Part0 === hat || joint.Part1 === hat)) {
			joint.Destroy();
		} else if (joint.IsA("WeldConstraint") && (joint.Part0 === hat || joint.Part1 === hat)) {
			joint.Destroy();
		}
	});

	const heightAboveHead = head.Size.Y / 2 + hat.Size.Y / 2;
	const hatPosition = head.Position.add(new Vector3(0, heightAboveHead, 0));
	hat.CFrame = new CFrame(hatPosition).mul(head.CFrame.Rotation);
	hat.CanCollide = false;
	hat.Massless = true;

	const hatWeld = new Instance("WeldConstraint");
	hatWeld.Part0 = head;
	hatWeld.Part1 = hat;
	hatWeld.Parent = hat;
}

function replaceWithTestRig(
	player: Player,
	currentCharacter: Model,
	characterName: RigCharacterName,
): void {
	const assetId = RIG_CHARACTERS[characterName].assetId;
	if (currentCharacter.GetAttribute("TestRigAssetId") === assetId) {
		return;
	}

	const template = getTestRigTemplate(characterName);
	if (!template) {
		return;
	}

	const rig = template.Clone();
	const humanoid = rig.FindFirstChildOfClass("Humanoid");
	const root = rig.FindFirstChild("HumanoidRootPart", true);
	if (!humanoid || !root?.IsA("BasePart")) {
		rig.Destroy();
		warn(`Cloned ${characterName} rig asset ${assetId} is missing its Humanoid or HumanoidRootPart.`);
		return;
	}

	rig.Name = player.Name;
	rig.SetAttribute("TestRigAssetId", assetId);
	humanoid.DisplayName = characterName;
	humanoid.RequiresNeck = false;
	rig.PrimaryPart = root;
	rig.GetDescendants().forEach((descendant) => {
		if (descendant.IsA("BasePart")) {
			descendant.Anchored = false;
			descendant.CanCollide = false;
			descendant.CollisionGroup = "Default";
		}
	});
	root.Transparency = 1;
	root.CastShadow = false;
	root.CanTouch = true;
	root.CanCollide = false;

	const chest = rig.FindFirstChild("Chest", true);
	const rootHasJoint = rig.GetDescendants().some((joint) => {
		if (joint.IsA("JointInstance") || joint.IsA("WeldConstraint")) {
			return joint.Part0 === root || joint.Part1 === root;
		}
		return false;
	});
	if (chest?.IsA("BasePart") && !rootHasJoint) {
		const rootJoint = new Instance("Motor6D");
		rootJoint.Name = "RootJoint";
		rootJoint.Part0 = root;
		rootJoint.Part1 = chest;
		rootJoint.C0 = root.CFrame.ToObjectSpace(chest.CFrame);
		rootJoint.C1 = new CFrame();
		rootJoint.Parent = root;
	}

	rig.Parent = Workspace;
	const spawnAltitudeOffset = 0; // studs
	rig.PivotTo(new CFrame(0, spawnAltitudeOffset, 0).mul(currentCharacter.GetPivot()));
	const rootMotor = rig.GetDescendants().find((descendant) => {
		return (
			descendant.IsA("Motor6D") &&
			(descendant.Part0 === root || descendant.Part1 === root)
		);
	});
	if (rootMotor?.IsA("Motor6D")) {
		const yaw = math.rad(TEST_RIG_VISUAL_YAW_OFFSET_DEGREES);
		const worldYawAroundRoot = new CFrame(root.Position)
			.mul(CFrame.Angles(0, yaw, 0))
			.mul(new CFrame(root.Position).Inverse());
		if (rootMotor.Part0 === root) {
			const targetPart1 = root.CFrame.mul(rootMotor.C0).mul(rootMotor.C1.Inverse());
			const correctedPart1 = worldYawAroundRoot.mul(targetPart1);
			rootMotor.C0 = root.CFrame.ToObjectSpace(correctedPart1.mul(rootMotor.C1));
		} else {
			const targetPart0 = root.CFrame.mul(rootMotor.C1).mul(rootMotor.C0.Inverse());
			const correctedPart0 = worldYawAroundRoot.mul(targetPart0);
			rootMotor.C1 = root.CFrame.ToObjectSpace(correctedPart0.mul(rootMotor.C0));
		}
	} else {
		warn(`${characterName} rig ${assetId} has no root Motor6D to correct its facing direction.`);
	}
	hideInactiveExpressions(rig);
	attachHatToHead(rig);
	const weldedPartCount = weldLooseRigParts(rig, root);
	const [morphBoundsFrame, morphBoundsSize] = rig.GetBoundingBox();
	root.Size = new Vector3(2, 2, 1);
	const morphBottom = morphBoundsFrame.Position.Y - morphBoundsSize.Y / 2;
	humanoid.HipHeight = math.max(0, root.Position.Y - morphBottom - root.Size.Y / 2);
	if (weldedPartCount > 0) {
		print(`Attached ${weldedPartCount} loose parts on ${characterName} rig ${assetId}.`);
	}

	if (player.Character !== currentCharacter) {
		rig.Destroy();
		return;
	}

	if (!originalCharacters.has(player)) {
		originalCharacters.set(player, currentCharacter);
	}
	player.Character = rig;
	currentCharacter.Parent = ServerStorage;
	if (currentCharacter !== originalCharacters.get(player)) {
		currentCharacter.Destroy();
	}
	root.Anchored = false;
	root.CanCollide = true;
	root.CollisionGroup = "Default";
	configureTestRigMovement(rig);

	const [ownsNetwork, networkError] = pcall(() => root.SetNetworkOwner(player));
	if (!ownsNetwork) {
		warn(`Could not assign test rig network ownership to player ${player.UserId}: ${tostring(networkError)}`);
	}
}

function restorePlayerAvatar(player: Player, currentCharacter: Model): void {
	const originalCharacter = originalCharacters.get(player);
	if (!originalCharacter) {
		warn(`No saved avatar is available to restore for player ${player.UserId}.`);
		return;
	}

	originalCharacter.Parent = Workspace;
	originalCharacter.PivotTo(currentCharacter.GetPivot());

	if (player.Character !== currentCharacter) {
		originalCharacter.Parent = ServerStorage;
		return;
	}

	player.Character = originalCharacter;
	currentCharacter.Destroy();
	originalCharacters.delete(player);
}

function removePlayerWeapons(player: Player): void {
	const backpack = player.FindFirstChildOfClass("Backpack");
	const character = player.Character;
	const containers: Instance[] = [];

	if (backpack) {
		containers.push(backpack);
	}
	if (character) {
		containers.push(character);
	}

	containers.forEach((container) => {
		container.GetChildren().forEach((child) => {
			if (child.IsA("Tool") && (child.Name === "Sword" || child.Name === "Bow")) {
				child.Destroy();
			}
		});
	});
}

function addWeldedPart(
	tool: Tool,
	handle: BasePart,
	name: string,
	size: Vector3,
	offset: Vector3,
	color: Color3,
): void {
	const part = new Instance("Part");
	part.Name = name;
	part.Size = size;
	part.CFrame = handle.CFrame.mul(new CFrame(offset));
	part.Color = color;
	part.Material = Enum.Material.Metal;
	part.CanCollide = false;
	part.Massless = true;
	part.Parent = tool;

	const weld = new Instance("WeldConstraint");
	weld.Part0 = handle;
	weld.Part1 = part;
	weld.Parent = part;
}

function createWeapon(loadout: (typeof characterLoadouts)[number]): Tool {
	const tool = new Instance("Tool");
	tool.Name = loadout.weapon;
	tool.ToolTip = `${loadout.character} - ${loadout.weapon}`;
	tool.CanBeDropped = false;
	tool.RequiresHandle = true;

	const handle = new Instance("Part");
	handle.Name = "Handle";
	handle.Size = new Vector3(0.3, 1, 0.3);
	handle.Color = loadout.weapon === "Sword" ? Color3.fromRGB(90, 65, 45) : Color3.fromRGB(115, 80, 48);
	handle.Material = Enum.Material.Wood;
	handle.CanCollide = false;
	handle.Massless = true;
	handle.Parent = tool;

	if (loadout.weapon === "Sword") {
		addWeldedPart(
			tool,
			handle,
			"Blade",
			new Vector3(0.2, 2.4, 0.35),
			new Vector3(0, 1.6, 0),
			Color3.fromRGB(205, 220, 235),
		);
	} else {
		addWeldedPart(
			tool,
			handle,
			"UpperBow",
			new Vector3(0.2, 1.7, 0.2),
			new Vector3(0.45, 0.5, 0),
			Color3.fromRGB(139, 94, 55),
		);
		addWeldedPart(
			tool,
			handle,
			"LowerBow",
			new Vector3(0.2, 1.7, 0.2),
			new Vector3(-0.45, 0.5, 0),
			Color3.fromRGB(139, 94, 55),
		);
	}

	return tool;
}

function equipSelectedWeapon(player: Player): void {
	const selectedCharacter = player.GetAttribute("SelectedCharacter");
	if (!typeIs(selectedCharacter, "string")) {
		return;
	}

	const loadout = findLoadout(selectedCharacter);
	if (!loadout) {
		warn(`No character loadout found for ${selectedCharacter}.`);
		return;
	}

	const backpack = player.FindFirstChildOfClass("Backpack") ?? player.WaitForChild("Backpack");
	removePlayerWeapons(player);
	if (loadout.weapon === "Fists") {
		return;
	}
	createWeapon(loadout).Parent = backpack;
}

function getAttackOrigin(character: Model): CFrame | undefined {
	const head = character.FindFirstChild("Head");
	if (head?.IsA("BasePart")) {
		return head.CFrame;
	}

	const root = character.FindFirstChild("HumanoidRootPart");
	if (root?.IsA("BasePart")) {
		return root.CFrame;
	}
}

function createArrowTrail(origin: Vector3, endpoint: Vector3): void {
	const distance = origin.sub(endpoint).Magnitude;
	if (distance <= 0) {
		return;
	}

	const trail = new Instance("Part");
	trail.Name = "ArrowTrail";
	trail.Size = new Vector3(0.12, 0.12, distance);
	trail.CFrame = CFrame.lookAt(origin, endpoint).mul(new CFrame(0, 0, -distance / 2));
	trail.Color = Color3.fromRGB(220, 200, 150);
	trail.Material = Enum.Material.Metal;
	trail.Anchored = true;
	trail.CanCollide = false;
	trail.Parent = Workspace;
	task.delay(0.12, () => trail.Destroy());
}

function showRageHitbox(hitboxCFrame: CFrame, hitboxSize: Vector3): void {
	const hitbox = new Instance("Part");
	hitbox.Name = "RageAttackHitbox";
	hitbox.Size = hitboxSize;
	hitbox.CFrame = hitboxCFrame;
	hitbox.Color = Color3.fromRGB(255, 0, 0);
	hitbox.Material = Enum.Material.Neon;
	hitbox.Transparency = 0.5;
	hitbox.Anchored = true;
	hitbox.CanCollide = false;
	hitbox.CanTouch = false;
	hitbox.CanQuery = false;
	hitbox.CastShadow = false;
	hitbox.Parent = Workspace;
	task.delay(RAGE_HITBOX_VISUAL_TIME, () => hitbox.Destroy());
}

function performRageAttack(
	player: Player,
	character: Model,
	root: BasePart,
	damage: number,
	range: number,
): void {
	const chest = character.FindFirstChild("Chest", true);
	const hitboxOrigin = chest?.IsA("BasePart") ? chest : root;
	let direction = new Vector3(hitboxOrigin.CFrame.LookVector.X, 0, hitboxOrigin.CFrame.LookVector.Z);
	if (direction.Magnitude <= 0.001) {
		direction = new Vector3(root.CFrame.LookVector.X, 0, root.CFrame.LookVector.Z);
	}
	if (direction.Magnitude <= 0.001) {
		return;
	}
	direction = direction.Unit;

	const hitboxSize = new Vector3(4, 4, range);
	const overlapParams = new OverlapParams();
	overlapParams.FilterType = Enum.RaycastFilterType.Exclude;
	overlapParams.FilterDescendantsInstances = [character];
	const damagedHumanoids = new Set<Humanoid>();
	let lastVisualPosition: Vector3 | undefined;
	const startedAt = os.clock();

	task.spawn(() => {
		while (
			os.clock() - startedAt < RAGE_HITBOX_ACTIVE_TIME &&
			root.Parent &&
			player.Character === character &&
			player.GetAttribute("SelectedCharacter") === "Rage"
		) {
			const hitboxCenter = hitboxOrigin.Position.add(direction.mul(range / 2));
			const hitboxCFrame = CFrame.lookAt(hitboxCenter, hitboxCenter.add(direction));
			if (!lastVisualPosition || hitboxCenter.sub(lastVisualPosition).Magnitude > 0.1) {
				showRageHitbox(hitboxCFrame, hitboxSize);
				lastVisualPosition = hitboxCenter;
			}

			Workspace.GetPartBoundsInBox(hitboxCFrame, hitboxSize, overlapParams).forEach((part) => {
				const target = part.FindFirstAncestorOfClass("Model");
				const humanoid = target?.FindFirstChildOfClass("Humanoid");
				if (
					target &&
					target !== character &&
					humanoid &&
					humanoid.Health > 0 &&
					!damagedHumanoids.has(humanoid)
				) {
					damagedHumanoids.add(humanoid);
					humanoid.TakeDamage(damage);
				}
			});
			task.wait(RAGE_HITBOX_SAMPLE_INTERVAL);
		}
	});
}

function attack(player: Player, weaponName: string, aimDirection: Vector3): void {
	const selectedCharacter = player.GetAttribute("SelectedCharacter");
	if (!typeIs(selectedCharacter, "string")) {
		return;
	}

	const aimMagnitude = aimDirection.Magnitude;
	if (aimMagnitude < 0.001 || aimMagnitude > 1_000_000 || aimMagnitude !== aimMagnitude) {
		return;
	}

	const loadout = findLoadout(selectedCharacter);
	const character = player.Character;
	if (!loadout || loadout.weapon !== weaponName || !character) {
		return;
	}

	if (loadout.weapon !== "Fists") {
		const equippedTool = character.FindFirstChild(weaponName);
		const backpackTool = player.FindFirstChildOfClass("Backpack")?.FindFirstChild(weaponName);
		if (!equippedTool?.IsA("Tool") && !backpackTool?.IsA("Tool")) {
			return;
		}
	}

	const now = os.clock();
	const nextAttack = nextAttackTime.get(player);
	if (nextAttack !== undefined && now < nextAttack) {
		return;
	}
	nextAttackTime.set(player, now + loadout.cooldown);

	if (loadout.weapon === "Fists") {
		const root = character.FindFirstChild("HumanoidRootPart", true);
		if (!root?.IsA("BasePart")) {
			return;
		}
		performRageAttack(player, character, root, loadout.damage, loadout.range);
		return;
	}

	const originFrame = getAttackOrigin(character);
	if (!originFrame) {
		return;
	}

	const origin = originFrame.Position;
	const direction = aimDirection.Unit;
	const raycastParams = new RaycastParams();
	raycastParams.FilterType = Enum.RaycastFilterType.Exclude;
	raycastParams.FilterDescendantsInstances = [character];

	const result = Workspace.Raycast(origin, direction.mul(loadout.range), raycastParams);
	if (loadout.weapon === "Bow") {
		createArrowTrail(origin, result ? result.Position : origin.add(direction.mul(loadout.range)));
	}

	if (!result) {
		return;
	}

	const target = result.Instance.FindFirstAncestorOfClass("Model");
	if (!target || target === character) {
		return;
	}

	const humanoid = target.FindFirstChildOfClass("Humanoid");
	if (humanoid && humanoid.Health > 0) {
		humanoid.TakeDamage(loadout.damage);
	}
}

selectionEvent.OnServerEvent.Connect((player, characterName) => {
	if (!typeIs(characterName, "string") || !findLoadout(characterName)) {
		warn(`Rejected invalid character selection from player ${player.UserId}.`);
		return;
	}

	player.SetAttribute("SelectedCharacter", characterName);
	const currentCharacter = player.Character;
	if (currentCharacter) {
		const rigCharacter = findRigCharacter(characterName);
		if (rigCharacter) {
			replaceWithTestRig(player, currentCharacter, rigCharacter);
		} else if (isManagedRig(currentCharacter)) {
			restorePlayerAvatar(player, currentCharacter);
		}
	}
	equipSelectedWeapon(player);
});

abilityEvent.OnServerEvent.Connect((player, weaponName, aimDirection) => {
	if (!typeIs(weaponName, "string") || !typeIs(aimDirection, "Vector3")) {
		return;
	}

	attack(player, weaponName, aimDirection);
});

sprintEvent.OnServerEvent.Connect((player, isSprinting) => {
	if (!typeIs(isSprinting, "boolean")) {
		return;
	}

	const character = player.Character;
	const selectedCharacter = player.GetAttribute("SelectedCharacter");
	const rigCharacter = typeIs(selectedCharacter, "string")
		? findRigCharacter(selectedCharacter)
		: undefined;
	if (!character || !rigCharacter || character.GetAttribute("TestRigAssetId") !== RIG_CHARACTERS[rigCharacter].assetId) {
		return;
	}

	const humanoid = character.FindFirstChildOfClass("Humanoid");
	if (humanoid) {
		humanoid.WalkSpeed = isSprinting ? TEST_RIG_SPRINT_SPEED : TEST_RIG_WALK_SPEED;
	}
});

Players.PlayerAdded.Connect((player) => {
	player.CharacterAdded.Connect((character) => {
		task.defer(() => {
			if (player.Character !== character) {
				return;
			}

			if (isManagedRig(character)) {
				const root = character.FindFirstChild("HumanoidRootPart", true);
				if (root?.IsA("BasePart")) {
					root.Anchored = false;
					root.CanCollide = true;
					root.CollisionGroup = "Default";
				}
				configureTestRigMovement(character);
			}

			const selectedCharacter = player.GetAttribute("SelectedCharacter");
			const rigCharacter = typeIs(selectedCharacter, "string")
				? findRigCharacter(selectedCharacter)
				: undefined;
			if (rigCharacter) {
				replaceWithTestRig(player, character, rigCharacter);
			}
			equipSelectedWeapon(player);
		});
	});
});

Players.PlayerRemoving.Connect((player) => {
	nextAttackTime.delete(player);
	const originalCharacter = originalCharacters.get(player);
	if (originalCharacter) {
		originalCharacter.Destroy();
		originalCharacters.delete(player);
	}
});
