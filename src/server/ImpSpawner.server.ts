const AssetService = game.GetService("AssetService");
const ServerStorage = game.GetService("ServerStorage");
const Workspace = game.GetService("Workspace");

const SPAWN_RADIUS = 80; 
const PLACEMENT_ATTEMPTS = 60; 
const MAX_RADIUS_GROWTHS = 6; 
const GROUND_RAY_HEIGHT = 3000;
const GROUND_RAY_LENGTH = 6000;
const EXTRA_IMP_COUNT = 150;
const PREFERRED_IMP_SPACING = 200;
const SPAWN_GRID_LAYOUT_ATTEMPTS = 100;
const SPAWN_MARKER_FOLDER_NAME = "ImpSpawn";
const IMP_ROOT_CLEARANCE = 4;
const FALLBACK_MINIMUM_SPACING = 8;

interface ImpSpawnPlan {
	positions: Vector3[];
	markerPositions: Vector3[];
	spacing: number;
}

const IMP_ASSET_IDS = [
	{ name: "Imp1", assetId: 99581582045896 },
	{ name: "Imp2", assetId: 103115873710340 },
	{ name: "Imp3", assetId: 97326570689480 },
	{ name: "Imp4", assetId: 111308084167289 },
	{ name: "Imp5", assetId: 78941858894572 },
];

const spawnedImps = new Set<Model>();
const impTemplates: Model[] = [];
let spawnAttemptConnection: RBXScriptConnection | undefined;
let hasSpawned = false;

function getMainFloor(): BasePart | undefined {
	const floor2 = Workspace.FindFirstChild("MainFloor2", true);
	if (floor2?.IsA("BasePart")) {
		return floor2;
	}

	const floor = Workspace.FindFirstChild("MainFloor", true);
	return floor?.IsA("BasePart") ? floor : undefined;
}

function findImpRig(instance: Instance): Model | undefined {
	for (const child of instance.GetChildren()) {
		const rig = findImpRig(child);
		if (rig) {
			return rig;
		}
	}

	if (instance.IsA("Model") && instance.FindFirstChild("HumanoidRootPart", true)?.IsA("BasePart")) {
		return instance;
	}
}

function loadImpTemplates(): void {
	IMP_ASSET_IDS.forEach(({ name, assetId }) => {
		const [success, asset] = pcall(() => AssetService.LoadAssetAsync(assetId));
		if (!success) {
			warn(`Failed to load ${name} imp asset ${assetId}: ${tostring(asset)}`);
			return;
		}
		if (!asset) {
			warn(`${name} imp asset ${assetId} was not available.`);
			return;
		}

		const rig = findImpRig(asset);
		if (!rig) {
			asset.Destroy();
			warn(`${name} imp asset ${assetId} has no model with a HumanoidRootPart.`);
			return;
		}

		rig.Name = `IMP_${name}`;
		rig.Parent = ServerStorage;
		if (rig !== asset) {
			asset.Destroy();
		}
		impTemplates.push(rig);
	});
}

function getSpawnMarkers(): BasePart[] {
	const folder = Workspace.FindFirstChild(SPAWN_MARKER_FOLDER_NAME, true);
	if (!folder?.IsA("Folder")) {
		return [];
	}

	return folder.GetChildren().filter(
		(child): child is BasePart => child.IsA("BasePart") && child.Name === "Spawn",
	);
}

function getSpawnGridLayout(
	floor: BasePart,
	spacing: number,
	offsetX: number,
	offsetZ: number,
): Vector3[] {
	const marginX = math.min(8, floor.Size.X / 10);
	const marginZ = math.min(8, floor.Size.Z / 10);
	const halfSizeX = math.max(0, floor.Size.X / 2 - marginX);
	const halfSizeZ = math.max(0, floor.Size.Z / 2 - marginZ);
	const rowSpacing = spacing * 0.8660254037844386;
	const positions: Vector3[] = [];
	let row = 0;

	for (let localZ = -halfSizeZ + offsetZ; localZ <= halfSizeZ; localZ += rowSpacing) {
		const stagger = row % 2 === 0 ? 0 : spacing / 2;
		for (
			let localX = -halfSizeX + offsetX + stagger;
			localX <= halfSizeX;
			localX += spacing
		) {
			positions.push(
				floor.CFrame.PointToWorldSpace(
					new Vector3(localX, floor.Size.Y / 2 + 0.5, localZ),
				),
			);
		}
		row++;
	}

	return positions;
}

function getMinimumSafeSpacing(): number {
	let minimumSpacing = FALLBACK_MINIMUM_SPACING;
	impTemplates.forEach((template) => {
		const root = template.FindFirstChild("HumanoidRootPart", true);
		if (!root?.IsA("BasePart")) {
			return;
		}
		minimumSpacing = math.max(
			minimumSpacing,
			math.max(root.Size.X, root.Size.Z) + IMP_ROOT_CLEARANCE,
		);
	});
	return minimumSpacing;
}


function findGround(origin: Vector3, ignore: Instance[]): Vector3 | undefined {
	const params = new RaycastParams();
	params.FilterType = Enum.RaycastFilterType.Exclude;
	params.FilterDescendantsInstances = ignore;

	const result = Workspace.Raycast(origin, new Vector3(0, -GROUND_RAY_LENGTH, 0), params);
	if (!result || result.Normal.Y < 0.5) {
		return undefined;
	}
	return result.Position;
}

function debugMarker(marker: BasePart, ignore: Instance[]): void {
	const params = new RaycastParams();
	params.FilterType = Enum.RaycastFilterType.Exclude;
	params.FilterDescendantsInstances = ignore;
	const result = Workspace.Raycast(
		marker.Position.add(new Vector3(0, GROUND_RAY_HEIGHT, 0)),
		new Vector3(0, -GROUND_RAY_LENGTH, 0),
		params,
	);
	if (!result) {
		warn(`[Debug] ${marker.GetFullName()} at ${marker.Position}: ray hit NOTHING below it.`);
	} else {
		warn(
			`[Debug] ${marker.GetFullName()} at ${marker.Position}: hit ${result.Instance.GetFullName()} (${result.Instance.ClassName}) at ${result.Position}, normal ${result.Normal}, Anchored=${result.Instance.Anchored}.`,
		);
	}
}

function getSpawnPositions(markers: BasePart[]): Vector3[] {
	const separation = getMinimumSafeSpacing();
	const separationSq = separation * separation;
	const ignore: Instance[] = [...markers];
	const positions: Vector3[] = [];

	const perMarker = math.floor(EXTRA_IMP_COUNT / markers.size());
	const remainder = EXTRA_IMP_COUNT % markers.size();

	markers.forEach((marker, markerIndex) => {
		const target = perMarker + (markerIndex < remainder ? 1 : 0);
		const center = marker.Position;
		let placed = 0;
		let radius = SPAWN_RADIUS;

		for (let growth = 0; growth <= MAX_RADIUS_GROWTHS && placed < target; growth++) {
			for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS && placed < target; attempt++) {
				const angle = math.random() * math.pi * 2;
				const distance = radius * math.sqrt(math.random());
				const origin = new Vector3(
					center.X + math.cos(angle) * distance,
					center.Y + GROUND_RAY_HEIGHT,
					center.Z + math.sin(angle) * distance,
				);

				const ground = findGround(origin, ignore);
				if (!ground) {
					continue;
				}

				const tooClose = positions.some((other) => {
					const dx = other.X - ground.X;
					const dz = other.Z - ground.Z;
					return dx * dx + dz * dz < separationSq;
				});
				if (tooClose) {
					continue;
				}

				positions.push(ground);
				placed++;
			}
			radius *= 1.25;
		}

		if (placed < target) {
			warn(`Spawn zone ${markerIndex + 1} only fit ${placed}/${target} imps.`);
			debugMarker(marker, ignore);
		}
	});

	return positions;
}

function hideSpawnMarkers(markers: BasePart[]): void {
	// Hide only; never move them.
	markers.forEach((marker) => {
		marker.Anchored = true;
		marker.Transparency = 1;
		marker.CanCollide = false;
		marker.CanTouch = false;
		marker.CanQuery = false;
	});
}

function debugFloor(): void {
	const floor = Workspace.FindFirstChild("MainFloor2", true) ?? Workspace.FindFirstChild("MainFloor", true);
	if (floor?.IsA("BasePart")) {
		warn(`[Debug] Floor ${floor.GetFullName()} at ${floor.Position}, size ${floor.Size}, CanQuery=${floor.CanQuery}.`);
	} else {
		warn("[Debug] No MainFloor2 / MainFloor found.");
	}
}

function spawnExtraImps(): boolean {
	if (hasSpawned) {
		return true;
	}
	
	debugFloor();

	const markers = getSpawnMarkers();
	if (markers.size() === 0 || impTemplates.size() === 0) {
		return false;
	}

	const positions = getSpawnPositions(markers);
	if (positions.size() === 0) {
		return false; // ground probably not loaded yet, will retry
	}

	hideSpawnMarkers(markers);

	positions.forEach((spawnPosition, index) => {
		const template = impTemplates[index % impTemplates.size()];
		const clone = template.Clone();

		const root = clone.FindFirstChild("HumanoidRootPart", true);
		if (!root?.IsA("BasePart")) {
			clone.Destroy();
			return;
		}

		let humanoid = clone.FindFirstChildWhichIsA("Humanoid", true);
		if (!humanoid) {
			humanoid = new Instance("Humanoid");
			humanoid.Name = "Humanoid";
			humanoid.Parent = clone;
		}
		humanoid.RequiresNeck = false;

		const yaw = math.random() * math.pi * 2;
		clone.PivotTo(clone.GetPivot().mul(CFrame.Angles(0, yaw, 0)));

		const standHeight = humanoid.HipHeight + root.Size.Y / 2 + 0.5;
		const targetRootPosition = spawnPosition.add(new Vector3(0, standHeight, 0));
		clone.PivotTo(clone.GetPivot().add(targetRootPosition.sub(root.Position)));

		clone.Name = `${template.Name}_Spawn${index + 1}`;
		clone.SetAttribute("ImpMinimumSeparation", getMinimumSafeSpacing());
		clone.Parent = Workspace;
		spawnedImps.add(clone);
	});

	hasSpawned = spawnedImps.size() > 0;
	print(`Imp spawner created ${spawnedImps.size()} imps around ${markers.size()} spawn zones.`);
	return hasSpawned;
}

function trySpawn(attempt = 0): void {
	if (spawnExtraImps() || attempt >= 10) {
		return;
	}
	// Map or streaming may not be ready yet; retry shortly.
	task.delay(2, () => trySpawn(attempt + 1));
}

loadImpTemplates();
task.defer(trySpawn);