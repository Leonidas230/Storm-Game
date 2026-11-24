const player = game.GetService("Players").LocalPlayer;
const replicatedStorage = game.GetService("ReplicatedStorage");
const UserInputService = game.GetService("UserInputService");
const abilityEvent = replicatedStorage.WaitForChild("UseCharacterAbility") as RemoteEvent;

const connectedTools = new Set<Tool>();
const Workspace = game.GetService("Workspace");
let lastMouseClickAt = -math.huge;

function playAttackAnimation(character: Model): void {
	const selectedCharacter = player.GetAttribute("SelectedCharacter");
	if (selectedCharacter === "Rage" || selectedCharacter === "Flood" || selectedCharacter === "Rain") {
		const request = character.GetAttribute("AttackAnimationRequest");
		const nextRequest = typeIs(request, "number") ? request + 1 : 1;
		character.SetAttribute("AttackAnimationRequest", nextRequest);
	}
}

function useAbility(weaponName: string): void {
	const camera = Workspace.CurrentCamera;
	if (!camera) {
		warn("Cannot use the character ability because the camera is unavailable.");
		return;
	}

	abilityEvent.FireServer(weaponName, camera.CFrame.LookVector);
}

function getSelectedWeaponName(): string | undefined {
	const selectedCharacter = player.GetAttribute("SelectedCharacter");
	if (selectedCharacter === "Rage") {
		return "Fists";
	}
	if (selectedCharacter === "Flood") {
		return "Sword";
	}
	if (selectedCharacter === "Rain") {
		return "Bow";
	}
}

function bindTool(instance: Instance): void {
	if (!instance.IsA("Tool") || connectedTools.has(instance)) {
		return;
	}

	if (instance.Name !== "Sword" && instance.Name !== "Bow") {
		return;
	}

	connectedTools.add(instance);
	instance.Activated.Connect(() => {
		task.defer(() => {
			if (os.clock() - lastMouseClickAt < 0.2) {
				return;
			}
			if (player.Character) {
				playAttackAnimation(player.Character);
			}
			useAbility(instance.Name);
		});
	});
}

UserInputService.InputBegan.Connect((input, gameProcessedEvent) => {
	if (
		gameProcessedEvent ||
		input.UserInputType !== Enum.UserInputType.MouseButton1
	) {
		return;
	}

	const weaponName = getSelectedWeaponName();
	if (!weaponName) {
		return;
	}
	lastMouseClickAt = os.clock();
	const character = player.Character;
	if (character) {
		playAttackAnimation(character);
	}
	useAbility(weaponName);
});

const backpack = player.WaitForChild("Backpack") as Backpack;
backpack.GetChildren().forEach(bindTool);
backpack.ChildAdded.Connect(bindTool);

player.CharacterAdded.Connect((character) => {
	character.GetChildren().forEach(bindTool);
	character.ChildAdded.Connect(bindTool);
});

if (player.Character) {
	player.Character.GetChildren().forEach(bindTool);
}
